// Splits a project's extracted structured fields into retrieval-sized
// passages for `project_chunk`. There is no separate raw-text export of the
// source PDF available (Gemini reads the PDF bytes directly, see
// gemini.server.ts) — so chunks are built from the same structured fields
// already shown to the user on the review card. This keeps chunk content
// traceable 1:1 to a labeled section, which is what the advisor's citations
// need (`sectionTitle`), rather than inventing page-level raw text.

const MAX_CHUNK_CHARS = 900;
const OVERLAP_CHARS = 120;

export type ChunkSource = {
	sectionTitle: string;
	text: string | null | undefined;
};

export type ProjectChunkDraft = {
	sectionTitle: string;
	content: string;
};

function splitLongText(text: string): string[] {
	if (text.length <= MAX_CHUNK_CHARS) return [text];

	const pieces: string[] = [];
	let start = 0;
	while (start < text.length) {
		let end = Math.min(start + MAX_CHUNK_CHARS, text.length);
		if (end < text.length) {
			// Prefer breaking on a sentence or whitespace boundary near `end`
			// rather than mid-word.
			const boundary = text.lastIndexOf(". ", end);
			if (boundary > start + MAX_CHUNK_CHARS / 2) {
				end = boundary + 1;
			} else {
				const space = text.lastIndexOf(" ", end);
				if (space > start + MAX_CHUNK_CHARS / 2) end = space;
			}
		}
		pieces.push(text.slice(start, end).trim());
		if (end >= text.length) break;
		start = Math.max(end - OVERLAP_CHARS, start + 1);
	}
	return pieces.filter((piece) => piece.length > 0);
}

/**
 * Builds chunk drafts (section + content, no ids/embeddings yet) from a
 * project's extracted fields. Sources with no text are skipped entirely —
 * never chunk a null/empty field.
 */
export function buildProjectChunkDrafts(
	sources: ChunkSource[],
): ProjectChunkDraft[] {
	const drafts: ProjectChunkDraft[] = [];

	for (const source of sources) {
		const text = source.text?.replace(/\s+/g, " ").trim();
		if (!text) continue;

		const pieces = splitLongText(text);
		for (const content of pieces) {
			drafts.push({ sectionTitle: source.sectionTitle, content });
		}
	}

	return drafts;
}

/** Combines a project's fields (in a fixed, citation-friendly order) into chunk sources. */
export function projectFieldsToChunkSources(fields: {
	abstract?: string | null;
	problemStatement?: string | null;
	objectives?: string[] | null;
	methodology?: string | null;
	results?: string | null;
	conclusion?: string | null;
}): ChunkSource[] {
	return [
		{ sectionTitle: "Abstract", text: fields.abstract },
		{ sectionTitle: "Problem statement", text: fields.problemStatement },
		{
			sectionTitle: "Objectives",
			text: fields.objectives?.length ? fields.objectives.join(" ") : null,
		},
		{ sectionTitle: "Methodology", text: fields.methodology },
		{ sectionTitle: "Results", text: fields.results },
		{ sectionTitle: "Conclusion", text: fields.conclusion },
	];
}
