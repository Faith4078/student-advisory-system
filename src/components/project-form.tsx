import { Sparkles, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useState } from "react";

export type ProjectFormValues = {
	title: string;
	author: string;
	department: string;
	faculty: string;
	projectType: string;
	researchArea: string;
	keywords: string[];
	technologies: string[];
	problemStatement: string;
	objectives: string[];
	methodology: string;
	results: string;
	conclusion: string;
	projectYear: string;
	abstract: string;
};

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
	title: "",
	author: "",
	department: "",
	faculty: "",
	projectType: "",
	researchArea: "",
	keywords: [],
	technologies: [],
	problemStatement: "",
	objectives: [],
	methodology: "",
	results: "",
	conclusion: "",
	projectYear: "",
	abstract: "",
};

export function projectToFormValues(source: {
	title: string | null;
	author: string | null;
	department: string | null;
	faculty: string | null;
	projectType: string | null;
	researchArea: string | null;
	keywords: string[] | null;
	technologies: string[] | null;
	problemStatement: string | null;
	objectives: string[] | null;
	methodology: string | null;
	results: string | null;
	conclusion: string | null;
	projectYear: number | null;
	abstract: string | null;
}): ProjectFormValues {
	return {
		title: source.title ?? "",
		author: source.author ?? "",
		department: source.department ?? "",
		faculty: source.faculty ?? "",
		projectType: source.projectType ?? "",
		researchArea: source.researchArea ?? "",
		keywords: source.keywords ?? [],
		technologies: source.technologies ?? [],
		problemStatement: source.problemStatement ?? "",
		objectives: source.objectives ?? [],
		methodology: source.methodology ?? "",
		results: source.results ?? "",
		conclusion: source.conclusion ?? "",
		projectYear: source.projectYear ? String(source.projectYear) : "",
		abstract: source.abstract ?? "",
	};
}

export function formValuesToInput(values: ProjectFormValues) {
	return {
		title: values.title,
		author: values.author,
		department: values.department,
		faculty: values.faculty,
		projectType: values.projectType,
		researchArea: values.researchArea,
		keywords: values.keywords,
		technologies: values.technologies,
		problemStatement: values.problemStatement,
		objectives: values.objectives,
		methodology: values.methodology,
		results: values.results,
		conclusion: values.conclusion,
		projectYear: values.projectYear ? Number(values.projectYear) : null,
		abstract: values.abstract,
	};
}

function TagListField({
	label,
	values,
	onChange,
	placeholder,
}: {
	label: string;
	values: string[];
	onChange: (values: string[]) => void;
	placeholder: string;
}) {
	const [draft, setDraft] = useState("");

	function add() {
		const value = draft.trim();
		if (!value) return;
		if (values.some((item) => item.toLowerCase() === value.toLowerCase())) {
			setDraft("");
			return;
		}
		onChange([...values, value]);
		setDraft("");
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			add();
		}
	}

	return (
		<div className="form-field">
			<label htmlFor={`tag-${label}`}>{label}</label>
			<div className="interest-input-row">
				<input
					id={`tag-${label}`}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					maxLength={80}
				/>
				<button type="button" onClick={add}>
					Add
				</button>
			</div>
			{values.length > 0 && (
				<ul className="interest-chip-list">
					{values.map((item) => (
						<li key={item}>
							{item}
							<button
								type="button"
								onClick={() => onChange(values.filter((v) => v !== item))}
								aria-label={`Remove ${item}`}
							>
								<X size={13} />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function ProjectForm({
	values,
	onChange,
	abstractSource,
}: {
	values: ProjectFormValues;
	onChange: (values: ProjectFormValues) => void;
	abstractSource?: "explicit" | "generated" | null;
}) {
	function set<K extends keyof ProjectFormValues>(
		key: K,
		value: ProjectFormValues[K],
	) {
		onChange({ ...values, [key]: value });
	}

	return (
		<div className="profile-form-body project-form-body">
			<div className="profile-field-grid">
				<div className="form-field">
					<label htmlFor="pf-title">Title</label>
					<input
						id="pf-title"
						value={values.title}
						onChange={(event) => set("title", event.target.value)}
						maxLength={300}
					/>
				</div>
				<div className="form-field">
					<label htmlFor="pf-author">Author</label>
					<input
						id="pf-author"
						value={values.author}
						onChange={(event) => set("author", event.target.value)}
						maxLength={200}
					/>
				</div>
			</div>

			<div className="profile-field-grid">
				<div className="form-field">
					<label htmlFor="pf-department">Department</label>
					<input
						id="pf-department"
						value={values.department}
						onChange={(event) => set("department", event.target.value)}
						maxLength={120}
					/>
				</div>
				<div className="form-field">
					<label htmlFor="pf-faculty">Faculty</label>
					<input
						id="pf-faculty"
						value={values.faculty}
						onChange={(event) => set("faculty", event.target.value)}
						maxLength={120}
					/>
				</div>
			</div>

			<div className="profile-field-grid">
				<div className="form-field">
					<label htmlFor="pf-type">Project type</label>
					<input
						id="pf-type"
						value={values.projectType}
						onChange={(event) => set("projectType", event.target.value)}
						placeholder="e.g. Final Year Project, SIWES Report"
						maxLength={80}
					/>
				</div>
				<div className="form-field">
					<label htmlFor="pf-year">Year</label>
					<input
						id="pf-year"
						value={values.projectYear}
						onChange={(event) =>
							set(
								"projectYear",
								event.target.value.replace(/\D/g, "").slice(0, 4),
							)
						}
						placeholder="e.g. 2025"
						inputMode="numeric"
					/>
				</div>
			</div>

			<div className="form-field">
				<label htmlFor="pf-research-area">Research area</label>
				<input
					id="pf-research-area"
					value={values.researchArea}
					onChange={(event) => set("researchArea", event.target.value)}
					maxLength={120}
				/>
			</div>

			<div className="form-field">
				<label htmlFor="pf-abstract">
					Abstract
					{abstractSource === "generated" && (
						<span className="ai-generated-badge">
							<Sparkles size={12} /> AI-generated — review before publishing
						</span>
					)}
				</label>
				<textarea
					id="pf-abstract"
					value={values.abstract}
					onChange={(event) =>
						set("abstract", event.target.value.slice(0, 2000))
					}
					rows={5}
				/>
			</div>

			<div className="form-field">
				<label htmlFor="pf-problem">Problem statement</label>
				<textarea
					id="pf-problem"
					value={values.problemStatement}
					onChange={(event) =>
						set("problemStatement", event.target.value.slice(0, 4000))
					}
					rows={3}
				/>
			</div>

			<TagListField
				label="Objectives"
				values={values.objectives}
				onChange={(value) => set("objectives", value)}
				placeholder="Add an objective"
			/>

			<div className="form-field">
				<label htmlFor="pf-methodology">Methodology</label>
				<textarea
					id="pf-methodology"
					value={values.methodology}
					onChange={(event) =>
						set("methodology", event.target.value.slice(0, 4000))
					}
					rows={3}
				/>
			</div>

			<div className="form-field">
				<label htmlFor="pf-results">Results</label>
				<textarea
					id="pf-results"
					value={values.results}
					onChange={(event) =>
						set("results", event.target.value.slice(0, 4000))
					}
					rows={3}
				/>
			</div>

			<div className="form-field">
				<label htmlFor="pf-conclusion">Conclusion</label>
				<textarea
					id="pf-conclusion"
					value={values.conclusion}
					onChange={(event) =>
						set("conclusion", event.target.value.slice(0, 4000))
					}
					rows={3}
				/>
			</div>

			<TagListField
				label="Keywords"
				values={values.keywords}
				onChange={(value) => set("keywords", value)}
				placeholder="Add a keyword"
			/>
			<TagListField
				label="Technologies"
				values={values.technologies}
				onChange={(value) => set("technologies", value)}
				placeholder="Add a technology"
			/>
		</div>
	);
}
