import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Brain, Sparkles, Trash2, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { DashboardSidebar, DashboardTopbar } from "../components/dashboard-shell";
import { getSession } from "../lib/auth.functions";
import {
	deleteAdvisorMemory,
	loadProfile,
	saveProfile,
} from "../lib/profile.functions";

const MAX_INTERESTS = 12;
const MAX_BIO_LENGTH = 600;

export const Route = createFileRoute("/dashboard_/profile")({
	beforeLoad: async ({ location }) => {
		const session = await getSession();
		if (!session) {
			throw redirect({
				to: "/signin",
				search: { redirect: location.href },
			});
		}
		return { user: session.user };
	},
	loader: () => loadProfile(),
	component: ProfilePage,
});

function ProfilePage() {
	const { user } = Route.useRouteContext();
	const { profile, memories, memoriesEnabled } = Route.useLoaderData();
	const router = useRouter();
	const saveProfileFn = useServerFn(saveProfile);
	const forgetMemoryFn = useServerFn(deleteAdvisorMemory);

	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [firstName, setFirstName] = useState(profile.firstName);
	const [lastName, setLastName] = useState(profile.lastName);
	const [department, setDepartment] = useState(profile.department);
	const [bio, setBio] = useState(profile.bio ?? "");
	const [interests, setInterests] = useState<string[]>(profile.interests);
	const [interestDraft, setInterestDraft] = useState("");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setFirstName(profile.firstName);
		setLastName(profile.lastName);
		setDepartment(profile.department);
		setBio(profile.bio ?? "");
		setInterests(profile.interests);
	}, [profile]);

	function addInterest() {
		const value = interestDraft.trim().slice(0, 40);
		if (!value) return;
		if (interests.some((item) => item.toLowerCase() === value.toLowerCase())) {
			setInterestDraft("");
			return;
		}
		if (interests.length >= MAX_INTERESTS) {
			toast.error(`You can add up to ${MAX_INTERESTS} interests.`);
			return;
		}
		setInterests((current) => [...current, value]);
		setInterestDraft("");
	}

	function removeInterest(value: string) {
		setInterests((current) => current.filter((item) => item !== value));
	}

	function handleInterestKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			addInterest();
		}
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			await saveProfileFn({
				data: { firstName, lastName, department, bio, interests },
			});
			await router.invalidate({ sync: true });
			toast.success("Profile updated.");
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "We couldn't save your profile.",
			);
		} finally {
			setSaving(false);
		}
	}

	async function handleForgetMemory(memoryId: string) {
		try {
			await forgetMemoryFn({ data: { memoryId } });
			await router.invalidate({ sync: true });
			toast.success("Memory removed.");
		} catch {
			toast.error("We couldn't remove that memory.");
		}
	}

	return (
		<main className="dashboard-page profile-page">
			<DashboardSidebar
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
				currentPath="/dashboard/profile"
				guide={
					<>
						<span>
							<Sparkles size={15} /> Your profile
						</span>
						<strong>Keep it current.</strong>
						<p>
							Your bio and interests help your AI Advisor give more relevant
							guidance.
						</p>
					</>
				}
			/>

			<section className="dashboard-main">
				<DashboardTopbar
					user={user}
					onOpenSidebar={() => setSidebarOpen(true)}
				/>

				<div className="dashboard-content">
					<div className="dashboard-title-row">
						<div>
							<span>YOUR PROFILE</span>
							<h1>Edit your profile</h1>
							<p>
								Keep your details current so your AI Advisor and department
								records stay accurate.
							</p>
						</div>
					</div>

					<div className="profile-grid">
						<form className="dashboard-card profile-form" onSubmit={handleSubmit}>
							<header>
								<div>
									<span>ACCOUNT</span>
									<h2>Personal details</h2>
								</div>
							</header>
							<div className="profile-form-body">
								<div className="profile-field-grid">
									<div className="form-field">
										<label htmlFor="firstName">First name</label>
										<input
											id="firstName"
											value={firstName}
											onChange={(event) => setFirstName(event.target.value)}
											maxLength={60}
											required
										/>
									</div>
									<div className="form-field">
										<label htmlFor="lastName">Last name</label>
										<input
											id="lastName"
											value={lastName}
											onChange={(event) => setLastName(event.target.value)}
											maxLength={60}
											required
										/>
									</div>
								</div>

								<div className="form-field">
									<label htmlFor="department">Department</label>
									<input
										id="department"
										value={department}
										onChange={(event) => setDepartment(event.target.value)}
										maxLength={80}
										required
									/>
								</div>

								<div className="profile-field-grid">
									<div className="form-field">
										<label htmlFor="matricNo">Matric no.</label>
										<input
											id="matricNo"
											value={profile.displayUsername ?? profile.username ?? ""}
											disabled
										/>
									</div>
									<div className="form-field">
										<label htmlFor="schoolEmail">School email</label>
										<input id="schoolEmail" value={profile.email} disabled />
									</div>
								</div>

								<div className="form-field">
									<label htmlFor="bio">A brief bio</label>
									<textarea
										id="bio"
										value={bio}
										onChange={(event) =>
											setBio(event.target.value.slice(0, MAX_BIO_LENGTH))
										}
										placeholder='e.g. "I am a machine learning engineer with 4+ years of experience. I am skilled in..."'
										rows={5}
									/>
									<small className="field-hint">
										{bio.length}/{MAX_BIO_LENGTH}
									</small>
								</div>

								<div className="form-field">
									<label htmlFor="interestDraft">Add your interests</label>
									<div className="interest-input-row">
										<input
											id="interestDraft"
											value={interestDraft}
											onChange={(event) => setInterestDraft(event.target.value)}
											onKeyDown={handleInterestKeyDown}
											placeholder="e.g. Machine learning, climate policy, UX research"
											maxLength={40}
										/>
										<button type="button" onClick={addInterest}>
											Add
										</button>
									</div>
									{interests.length > 0 && (
										<ul className="interest-chip-list">
											{interests.map((interest) => (
												<li key={interest}>
													{interest}
													<button
														type="button"
														onClick={() => removeInterest(interest)}
														aria-label={`Remove ${interest}`}
													>
														<X size={13} />
													</button>
												</li>
											))}
										</ul>
									)}
								</div>
							</div>
							<footer className="profile-form-footer">
								<button
									className="dashboard-primary-action"
									type="submit"
									disabled={saving}
								>
									{saving ? "Saving..." : "Save changes"}
								</button>
							</footer>
						</form>

						<aside className="dashboard-card memory-card">
							<header>
								<div>
									<span>AI ADVISOR</span>
									<h2>What it remembers about you</h2>
								</div>
								<Brain size={20} />
							</header>
							{!memoriesEnabled ? (
								<div className="empty-state">
									<span>
										<Brain size={24} />
									</span>
									<strong>Memory isn't connected yet</strong>
									<p>
										Once AI memory is configured, facts your advisor learns
										from chats will show up here.
									</p>
								</div>
							) : memories.length === 0 ? (
								<div className="empty-state">
									<span>
										<Brain size={24} />
									</span>
									<strong>Nothing remembered yet</strong>
									<p>
										Chat with your AI Advisor and anything worth remembering
										will appear here automatically.
									</p>
								</div>
							) : (
								<ul className="memory-list">
									{memories.map((memory) => (
										<li key={memory.id}>
											<p>{memory.memory}</p>
											<div className="memory-meta">
												{memory.updatedAt ? (
													<small>
														{new Date(memory.updatedAt).toLocaleDateString()}
													</small>
												) : null}
												<button
													type="button"
													onClick={() => handleForgetMemory(memory.id)}
													aria-label="Forget this"
												>
													<Trash2 size={14} />
												</button>
											</div>
										</li>
									))}
								</ul>
							)}
						</aside>
					</div>
				</div>
			</section>
		</main>
	);
}
