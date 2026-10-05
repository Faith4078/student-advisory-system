// Estimates which physical PDF page each late-chunked passage actually came
// from. Gemini's full-text transcription (see gemini.server.ts) is one
// continuous blob per project with no page boundaries of its own, so every
// chunk built from it used to be stamped with the project's first page
// (sourcePageRangeStart) regardless of where its content really falls — a
// 10-page project would cite "page 15" for content actually on page 19.
//
// Chunks are generated in strict document order (see buildFullTextChunkDrafts
// in chunking.server.ts), so this walks a forward-only cursor over the real
// PDF's per-page text — extracted independently via pdfjs-dist, not Gemini —
// and finds each chunk's best-matching page. Cheaper and more deterministic
// than asking Gemini to re-segment its own transcription by page.

let pdfjsLibPromise: Promise<
	typeof import("pdfjs-dist/legacy/build/pdf.mjs")
> | null = null;
function loadPdfjs() {
	pdfjsLibPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjsLibPromise;
}

type PageText = { pageNumber: number; text: string };

function normalize(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Extracts plain text per page, for pages [startPage, endPage] (1-indexed, inclusive, clamped to the document's real page count). */
export async function extractPdfPageTexts(input: {
	pdfBytes: Buffer;
	startPage: number;
	endPage: number;
}): Promise<PageText[]> {
	const pdfjsLib = await loadPdfjs();
	const task = pdfjsLib.getDocument({
		data: new Uint8Array(input.pdfBytes),
		disableFontFace: true,
		useSystemFonts: false,
	});
	const doc = await task.promise;
	try {
		const start = Math.max(1, input.startPage);
		const end = Math.min(doc.numPages, input.endPage);
		const pages: PageText[] = [];
		for (let pageNumber = start; pageNumber <= end; pageNumber++) {
			const page = await doc.getPage(pageNumber);
			const content = await page.getTextContent();
			const text = content.items
				.map((item) => ("str" in item ? item.str : ""))
				.join(" ");
			pages.push({ pageNumber, text });
		}
		return pages;
	} finally {
		await task.destroy();
	}
}

/**
 * Best-effort mapping of each chunk (in original document order) to the real
 * PDF page its text actually came from. Falls back to `fallbackPageNumber`
 * for every chunk if page text can't be extracted at all (e.g. a scanned,
 * image-only PDF with no text layer). Any individual chunk that can't be
 * matched keeps the last page matched before it — the cursor never regresses
 * to an earlier page, since chunks are strictly sequential.
 */
export async function estimateChunkPageNumbers(input: {
	pdfBytes: Buffer;
	pageRangeStart: number;
	pageRangeEnd: number;
	chunkContents: string[];
	fallbackPageNumber: number | null;
}): Promise<(number | null)[]> {
	const fallback = input.chunkContents.map(() => input.fallbackPageNumber);
	if (input.chunkContents.length === 0) return fallback;

	let pages: PageText[];
	try {
		pages = await extractPdfPageTexts({
			pdfBytes: input.pdfBytes,
			startPage: input.pageRangeStart,
			endPage: input.pageRangeEnd,
		});
	} catch (error) {
		console.error(
			"pdf-text: failed to extract page text, falling back to the project's first page for every chunk",
			error,
		);
		return fallback;
	}

	const normalizedPages = pages.map((p) => ({
		pageNumber: p.pageNumber,
		normalized: normalize(p.text),
	}));
	if (normalizedPages.every((p) => p.normalized.length === 0)) return fallback;

	let cursor = 0;
	const result: (number | null)[] = [];
	for (const content of input.chunkContents) {
		const needle = normalize(content).slice(0, 200);
		let matchedIndex: number | null = null;
		if (needle.length >= 20) {
			for (let i = cursor; i < normalizedPages.length; i++) {
				if (normalizedPages[i].normalized.includes(needle)) {
					matchedIndex = i;
					break;
				}
			}
			// A chunk's overlap lead-in (see OVERLAP_CHARS in chunking.server.ts)
			// can repeat the tail of the previous page — if nothing matched
			// forward, check earlier pages too, but never move the cursor back.
			if (matchedIndex === null && cursor > 0) {
				for (let i = 0; i < cursor; i++) {
					if (normalizedPages[i].normalized.includes(needle)) {
						matchedIndex = cursor;
						break;
					}
				}
			}
		}
		if (matchedIndex !== null) cursor = matchedIndex;
		result.push(
			normalizedPages[cursor]?.pageNumber ?? input.fallbackPageNumber,
		);
	}
	return result;
}
