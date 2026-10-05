lucide.createIcons();

const sidebarItems = document.querySelectorAll(".sidebar-item");
const content = document.getElementById("content");
const authActions = document.getElementById("auth-actions");
const navbarProfile = document.getElementById("navbar-profile");
const navbarFullName = document.getElementById("navbar-fullname");
let currentUser = null;
let knowledgeFiles = [];
let knowledgeAnalyses = [];
let knowledgePreviousAnalyses = [];
let showPreviousKnowledgeAnalyses = false;
let knowledgeIsAnalyzing = false;
let knowledgeAnalysisRun = 0;
let savedCourses = [];
let activePage = "dashboard";
let dashboardLoadRun = 0;
let savedCoursesLoading = false;
let savedCoursesError = "";
let studyFiles = [];
let studyPrompt = "";
let studyCards = [];
let studyQuiz = null;
let studyAnswers = {};
let studyExplainedQuestions = new Set();
let studyExplainingQuestions = new Map();
let studyPracticeOpen = false;
let savedQuizzes = [];
let savedQuizzesLoading = false;
let savedQuizzesError = "";
let savedQuizzesLoadRun = 0;
let studyQuizMutationPending = false;
let studyIsSubmitting = false;
let studyIsPreparingQuiz = false;
let studyRun = 0;
let savedConversations = [];
let savedConversationsLoading = false;
let savedConversationsError = "";
let savedConversationsLoadRun = 0;
let studyConversationId = null;
let studyConversationTitle = "";
let studyConversationDirty = false;
let studyConversationPending = false;
let studyQuizWidthPx = 0;
try {
    studyQuizWidthPx = Number(window.localStorage.getItem("campusflow-study-quiz-width")) || 0;
} catch {
    // The layout still works when browser storage is unavailable.
}
const maxKnowledgeFiles = 8;
const maxKnowledgeBatchBytes = 12 * 1024 * 1024;

window.addEventListener("resize", () => applyStudyQuizWidth());

function studyQuizWidthBounds() {
    const leftWidth = document.body.classList.contains("sidebar-collapsed") ? 0
        : window.innerWidth <= 650 ? 75 : window.innerWidth <= 900 ? 240 : 300;
    const min = 280;
    const max = Math.max(min, window.innerWidth - leftWidth - 320);
    return { min, max };
}

function applyStudyQuizWidth(width = studyQuizWidthPx) {
    const { min, max } = studyQuizWidthBounds();
    studyQuizWidthPx = Math.min(max, Math.max(min, width || Math.round(window.innerWidth * 0.4)));
    content.style.setProperty("--study-quiz-width", `${studyQuizWidthPx}px`);
    const resizer = document.getElementById("study-quiz-resizer");
    if (resizer) {
        resizer.setAttribute("aria-valuemin", String(min));
        resizer.setAttribute("aria-valuemax", String(max));
        resizer.setAttribute("aria-valuenow", String(studyQuizWidthPx));
    }
}

function saveStudyQuizWidth() {
    try { window.localStorage.setItem("campusflow-study-quiz-width", String(studyQuizWidthPx)); }
    catch { /* Resizing remains available without persistence. */ }
}

const pages = {
    dashboard: {
        title: "Your Campus, Organized.",
        description: "CampusFlow brings your academic life together in one place — courses, deadlines, study materials, exams, and more.",
        icon: "layout-dashboard"
    },
    knowledge: {
        title: "Course Knowledge",
        description: "Keep your syllabus, professor information, grading policies, assignments, attendance requirements, and important course information organized in one place.",
        icon: "library"
    },
    study: {
        title: "Study & Exam Prep",
        description: "Upload your lectures, practice exams, and study materials. CampusFlow's AI can help identify key concepts and generate personalized practice questions.",
        icon: "brain"
    },
    calendar: {
        title: "Calendar",
        description: "Keep track of classes, assignments, exams, deadlines, and important academic events with a centralized academic calendar.",
        icon: "calendar"
    },
    messages: {
        title: "Messages",
        description: "Keep your important academic conversations and notifications organized in one place.",
        icon: "mail"
    },
    support: {
        title: "Help & Support",
        description: "Find answers, get help with CampusFlow, and learn how to make the most of your academic workspace.",
        icon: "circle-help"
    }
};

function getFullName(user = currentUser) {
    return user?.user_metadata?.full_name || user?.email?.split("@")[0] || "CampusFlow User";
}

function escapeHTML(value) {
    const element = document.createElement("div");
    element.textContent = value;
    return element.innerHTML;
}

function updateNavbar() {
    const isSignedIn = Boolean(currentUser);
    authActions.hidden = isSignedIn;
    authActions.style.display = isSignedIn ? "none" : "flex";
    navbarProfile.hidden = !isSignedIn;
    navbarProfile.style.display = isSignedIn ? "flex" : "none";

    if (isSignedIn) {
        const fullName = getFullName();
        navbarFullName.textContent = fullName;
        navbarProfile.setAttribute("aria-label", `Open account settings for ${fullName}`);
    }
}

function renderAuthCTA() {
    return `
        <div class="cta">
            <button class="cta-btn cta-signin" type="button" onclick="handleSignIn()">Sign In</button>
            <button class="cta-btn cta-signup" type="button" onclick="handleSignUp()">Sign Up</button>
        </div>
        <p class="cta-message">Sign in or sign up for more.</p>
    `;
}

function showGuestPage(page) {
    const pageData = page === "account"
        ? { title: "Account", description: "Sign in to manage your CampusFlow profile and security settings.", icon: "user-round" }
        : pages[page];
    if (!pageData) return;
    content.innerHTML = `
        <div class="page-preview">
            <div class="page-preview-icon"><i data-lucide="${pageData.icon}"></i></div>
            <h1>${pageData.title}</h1>
            <p>${pageData.description}</p>
            ${page === "calendar" ? '<p class="coming-soon">Coming soon</p>' : ""}
            ${renderAuthCTA()}
        </div>
    `;
    lucide.createIcons();
}

function showPage(page) {
    activePage = page;
    content.classList.remove("has-dashboard", "has-study", "has-study-quiz");
    if (page === "about") {
        showAboutPage();
        return;
    }
    if (!currentUser) {
        showGuestPage(page);
        return;
    }
    if (page === "account") {
        showAccountPage();
        return;
    }

    if (page === "knowledge") {
        showKnowledgePage();
        return;
    }

    if (page === "dashboard") {
        showDashboardPage();
        return;
    }

    if (page === "study") {
        showStudyPage();
        return;
    }

    const pageData = pages[page];
    if (!pageData) return;

    content.innerHTML = `
        <div class="page-preview">
            <div class="page-preview-icon"><i data-lucide="${pageData.icon}"></i></div>
            <h1>${pageData.title}</h1>
            <p>${pageData.description}</p>
            ${page === "calendar" ? '<p class="coming-soon">Coming soon</p>' : ""}
        </div>
    `;
    lucide.createIcons();
}

function showAboutPage() {
    content.innerHTML = `
        <section class="about-page" aria-labelledby="about-title">
            <h1 id="about-title">About Us</h1>
            <p>Hi! I built this website on my own around my personal needs in college :). CampusFlow is completely free for everyone to use. If you run into any bugs or have a feature in mind that could make the website better, please leave your feedback below!</p>
            <form id="feedback-form" class="feedback-form">
                <h2>Help improve CampusFlow</h2>
                <label for="feedback-message">What would you like to improve?</label>
                <textarea id="feedback-message" name="message" rows="6" maxlength="3000" required placeholder="Tell me about a bug you found or a feature you'd like to see..."></textarea>
                <button type="submit">Send feedback</button>
                <p class="feedback-status" role="status" aria-live="polite"></p>
            </form>
        </section>
    `;
    document.getElementById("feedback-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const message = form.elements.message.value.trim();
        const status = form.querySelector(".feedback-status");
        const button = form.querySelector("button");
        if (!message) {
            status.textContent = "Please enter your feedback before sending.";
            return;
        }
        button.disabled = true;
        status.textContent = "Sending feedback...";
        try {
            if (!window.supabaseClient) throw new Error("Feedback unavailable");
            const { error } = await window.supabaseClient.from("feedback_requests").insert({ message });
            if (error) throw error;
            form.reset();
            status.textContent = "Thank you! Your feedback has been sent.";
        } catch {
            status.textContent = "Couldn't send your feedback. Please try again later; your message is still in the box above.";
        } finally {
            button.disabled = false;
        }
    });
}

document.querySelector(".about").addEventListener("click", (event) => {
    event.preventDefault();
    sidebarItems.forEach((item) => item.classList.remove("active"));
    showPage("about");
});

const primarySidebar = document.getElementById("primary-sidebar");
const sidebarClose = document.getElementById("sidebar-close");
const sidebarOpen = document.getElementById("sidebar-open");

function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    primarySidebar.hidden = collapsed;
    sidebarOpen.hidden = !collapsed;
    sidebarClose.setAttribute("aria-expanded", String(!collapsed));
    sidebarOpen.setAttribute("aria-expanded", String(!collapsed));
    applyStudyQuizWidth();
    (collapsed ? sidebarOpen : sidebarClose).focus();
}

sidebarClose.addEventListener("click", () => setSidebarCollapsed(true));
sidebarOpen.addEventListener("click", () => setSidebarCollapsed(false));

function showDashboardPage() {
    content.classList.add("has-dashboard");
    content.innerHTML = `
        <section class="dashboard-page" aria-labelledby="saved-courses-title">
            <section class="dashboard-saved" aria-labelledby="saved-courses-title">
                <h1 id="saved-courses-title">Saved courses</h1>
                <div id="saved-course-list" class="saved-course-list" aria-live="polite"></div>
            </section>
        </section>
    `;
    const list = document.getElementById("saved-course-list");
    list.textContent = "Loading saved courses…";
    loadSavedCourses(currentUser.id);
}

async function loadSavedCourses(userId) {
    const runId = ++dashboardLoadRun;
    savedCoursesLoading = true;
    savedCoursesError = "";
    renderSavedCourses();
    try {
        if (!window.supabaseClient) throw new Error("Saved courses are not configured yet.");
        const { data, error } = await window.supabaseClient
            .from("saved_courses")
            .select("id,course_name,schedule,course_period,key_points,small_details,created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });
        if (runId !== dashboardLoadRun || currentUser?.id !== userId) return;
        if (error) throw error;
        savedCourses = data || [];
    } catch (error) {
        if (runId !== dashboardLoadRun || currentUser?.id !== userId) return;
        console.error("Could not load saved courses:", error);
        savedCoursesError = "Could not load saved courses. Please try again.";
    } finally {
        if (runId === dashboardLoadRun && currentUser?.id === userId) {
            savedCoursesLoading = false;
            renderSavedCourses();
        }
    }
}

function renderSavedCourses() {
    const list = document.getElementById("saved-course-list");
    if (!list) return;
    list.replaceChildren();
    if (savedCoursesLoading || savedCoursesError) {
        list.textContent = savedCoursesLoading ? "Loading saved courses…" : savedCoursesError;
        if (savedCoursesError) {
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "knowledge-history-toggle";
            retry.textContent = "Try again";
            retry.addEventListener("click", () => loadSavedCourses(currentUser.id));
            list.append(retry);
        }
        return;
    }
    if (!savedCourses.length) {
        const empty = document.createElement("p");
        empty.className = "saved-course-empty";
        empty.textContent = "No saved courses yet. Analyze a file in Course Knowledge, then save its course card.";
        list.append(empty);
        return;
    }

    savedCourses.forEach((course) => {
        const item = document.createElement("article");
        item.className = "saved-course-item";
        const header = document.createElement("div");
        header.className = "saved-course-header";
        const expand = document.createElement("button");
        expand.type = "button";
        expand.className = "saved-course-expand";
        expand.setAttribute("aria-expanded", "false");
        expand.setAttribute("aria-label", `Show saved information for ${course.course_name}`);
        const heading = document.createElement("span");
        heading.className = "saved-course-name";
        heading.textContent = course.course_name;
        const metadata = document.createElement("span");
        metadata.className = "saved-course-meta";
        const schedule = document.createElement("span");
        schedule.textContent = `Schedule: ${course.schedule || "Not specified"}`;
        const period = document.createElement("span");
        period.textContent = `Course period: ${course.course_period || "Not specified"}`;
        metadata.append(schedule, period);
        const chevron = document.createElement("i");
        chevron.setAttribute("data-lucide", "chevron-down");
        expand.append(heading, metadata, chevron);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "saved-course-delete";
        remove.setAttribute("aria-label", `Delete ${course.course_name}`);
        remove.title = "Delete saved course";
        remove.innerHTML = '<i data-lucide="x"></i>';
        remove.addEventListener("click", () => deleteSavedCourse(course, remove));
        header.append(expand, remove);

        const details = document.createElement("div");
        details.className = "saved-course-details";
        details.id = `saved-course-details-${course.id}`;
        details.hidden = true;
        expand.setAttribute("aria-controls", details.id);
        const points = document.createElement("ul");
        points.className = "knowledge-analysis-points";
        (Array.isArray(course.key_points) ? course.key_points : []).forEach((point) => {
            const li = document.createElement("li");
            li.textContent = point;
            points.append(li);
        });
        details.append(points);
        if (Array.isArray(course.small_details) && course.small_details.length) {
            const detailHeading = document.createElement("h3");
            detailHeading.textContent = "Details worth noting";
            const detailList = document.createElement("ul");
            detailList.className = "knowledge-analysis-details";
            course.small_details.forEach((detail) => {
                const li = document.createElement("li");
                li.textContent = detail;
                detailList.append(li);
            });
            details.append(detailHeading, detailList);
        }
        expand.addEventListener("click", () => {
            details.hidden = !details.hidden;
            expand.setAttribute("aria-expanded", String(!details.hidden));
        });
        item.append(header, details);
        list.append(item);
    });
    lucide.createIcons();
}

async function deleteSavedCourse(course, button) {
    if (!window.confirm(`Delete saved course “${course.course_name}”?`)) return;
    const userId = currentUser?.id;
    if (!userId) return;
    button.disabled = true;
    const { error } = await window.supabaseClient.from("saved_courses")
        .delete().eq("id", course.id).eq("user_id", userId);
    if (currentUser?.id !== userId) return;
    if (error) {
        console.error("Could not delete saved course:", error);
        button.disabled = false;
        button.title = "Could not delete this course. Please try again.";
        const message = document.createElement("p");
        message.className = "saved-course-error";
        message.setAttribute("role", "alert");
        message.textContent = "Could not delete this course. Please try again.";
        button.closest(".saved-course-item")?.append(message);
        return;
    }
    savedCourses = savedCourses.filter((item) => item.id !== course.id);
    [...knowledgeAnalyses, ...knowledgePreviousAnalyses].forEach((analysis) => {
        if (analysis.savedId === course.id) {
            analysis.savedId = null;
            analysis.saved = false;
        }
    });
    renderSavedCourses();
}

function showStudyPage() {
    content.classList.add("has-study");
    content.innerHTML = `
        <section class="study-page" aria-labelledby="study-title">
            <div class="study-toolbar">
                <span class="study-eyebrow">YOUR STUDY SPACE</span>
                <div class="study-toolbar-actions">
                    <button id="study-retry-save" class="study-retry-button" type="button" hidden>Retry save</button>
                    <button id="study-clear-cards" class="study-clear-button" type="button"
                        aria-label="Clear study cards and current draft" hidden>Clear cards</button>
                    <button id="study-practice-toggle" class="study-courses-toggle" type="button"
                        aria-controls="study-quiz-sidebar" aria-expanded="false">
                        <i data-lucide="list-checks" aria-hidden="true"></i><span>Practice</span>
                    </button>
                </div>
            </div>
            <div class="study-workspace">
                <header class="knowledge-heading study-heading">
                    <div class="knowledge-heading-icon" aria-hidden="true"><i data-lucide="brain"></i></div>
                    <h1 id="study-title">Study &amp; Exam Prep</h1>
                    <p>Ask about any topic, or attach your study materials. Turn what you learn into a practice quiz.</p>
                </header>
                <section id="study-results" class="study-results" aria-label="Study results" aria-live="polite" hidden></section>
                <div class="study-draft">
                    <div id="study-composer" class="study-composer">
                        <input id="study-file-input" type="file" accept=".pdf,.txt,.csv" multiple hidden>
                        <div class="study-file-area">
                            <button id="study-browse-files" class="study-empty-state" type="button">
                                <span class="study-upload-icon" aria-hidden="true"><i data-lucide="files"></i></span>
                                <span class="study-upload-title">Files are optional · <span>browse files</span> or drop them here</span>
                                <span class="study-upload-help">PDF, TXT or CSV files (8 max, 12 MB total). Export slides as PDF.</span>
                            </button>
                            <div id="study-file-list" class="study-file-list" role="list" aria-label="Attached study files" hidden></div>
                        </div>
                        <div class="study-request-area">
                            <label for="study-request">What would you like to study or practice?</label>
                            <p id="study-context-note" class="study-context-note" aria-live="polite" hidden></p>
                            <textarea id="study-request" rows="3" maxlength="4000"
                                placeholder="Summarize the key concepts, explain a difficult topic, or create a practice exam…"
                                aria-describedby="study-context-note study-request-count"></textarea>
                            <div class="study-composer-footer">
                                <span id="study-file-count" role="status" aria-live="polite"></span>
                                <span id="study-request-count">0 / 4,000</span>
                                <button id="study-send" class="study-send-button" type="button" disabled>
                                    <i data-lucide="arrow-up" aria-hidden="true"></i><span>Send</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <p id="study-status" class="study-status" role="status" aria-live="polite" hidden></p>
                </div>
            </div>
        </section>
        <aside id="study-quiz-sidebar" class="study-quiz-sidebar" aria-labelledby="study-quiz-title" hidden>
            <header class="study-quiz-header">
                <div>
                    <span class="study-eyebrow">PRACTICE</span>
                    <h2 id="study-quiz-title">Practice</h2>
                    <p class="study-resize-hint">Drag the left edge to resize</p>
                </div>
                <button id="study-quiz-close" class="study-icon-button" type="button" aria-label="Close Practice">
                    <i data-lucide="x" aria-hidden="true"></i>
                </button>
            </header>
            <section class="study-practice-history" aria-labelledby="study-practice-history-title">
                <h3 id="study-practice-history-title">Saved quizzes</h3>
                <div id="study-practice-history" class="study-practice-history-list" aria-live="polite"></div>
                <p id="study-quiz-loading" class="study-course-message" hidden>Creating your quiz…</p>
            </section>
            <section class="study-conversation-history" aria-labelledby="study-conversations-title">
                <div class="study-conversations-heading">
                    <h3 id="study-conversations-title">Saved conversations</h3>
                    <button id="study-new-conversation" class="study-icon-button" type="button" aria-label="New conversation" title="New conversation">
                        <i data-lucide="plus" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="study-conversation-list" class="study-practice-history-list" aria-live="polite"></div>
            </section>
        </aside>
        <div id="study-quiz-resizer" class="study-quiz-resizer" role="separator" tabindex="0"
            aria-label="Resize quiz panel" aria-orientation="vertical"
            aria-controls="study-quiz-sidebar" hidden></div>
    `;

    const fileInput = document.getElementById("study-file-input");
    const composer = document.getElementById("study-composer");
    const request = document.getElementById("study-request");
    request.value = studyPrompt;
    updateStudyPromptCount();
    request.addEventListener("input", () => {
        studyPrompt = request.value;
        updateStudyPromptCount();
    });
    document.getElementById("study-send").addEventListener("click", sendStudyRequest);
    request.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            sendStudyRequest();
        }
    });
    document.getElementById("study-new-conversation").addEventListener("click", newStudyConversation);
    document.getElementById("study-retry-save").addEventListener("click", () => persistStudyConversation());
    document.getElementById("study-clear-cards").addEventListener("click", clearStudyCards);
    document.getElementById("study-practice-toggle").addEventListener("click", () => setStudyPracticeOpen(!studyPracticeOpen, true));
    document.getElementById("study-quiz-close").addEventListener("click", () => setStudyPracticeOpen(false, true));
    const quizResizer = document.getElementById("study-quiz-resizer");
    quizResizer.addEventListener("pointerdown", startStudyQuizResize);
    quizResizer.addEventListener("keydown", handleStudyQuizResizeKey);
    document.getElementById("study-browse-files").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
        addStudyFiles(fileInput.files);
        fileInput.value = "";
    });
    // Keep the input outside clickable file controls so its click cannot bubble into them.
    document.getElementById("study-file-list").addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-study-file]");
        if (remove) {
            const index = Number(remove.dataset.removeStudyFile);
            studyFiles.splice(index, 1);
            renderStudyFiles();
            const buttons = document.querySelectorAll("[data-remove-study-file]");
            (buttons[Math.min(index, buttons.length - 1)] || document.getElementById("study-browse-files")).focus();
        } else if (event.target.closest("#study-add-file")) {
            fileInput.click();
        }
    });
    let dragDepth = 0;
    const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
    composer.addEventListener("dragenter", (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth += 1;
        composer.classList.add("is-dragging");
    });
    composer.addEventListener("dragover", (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    });
    composer.addEventListener("dragleave", () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) composer.classList.remove("is-dragging");
    });
    composer.addEventListener("drop", (event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth = 0;
        composer.classList.remove("is-dragging");
        addStudyFiles(event.dataTransfer.files);
    });
    document.getElementById("study-quiz-sidebar").addEventListener("keydown", (event) => {
        if (event.key === "Escape") setStudyPracticeOpen(false, true);
    });
    renderStudyFiles();
    renderStudyResults();
    renderStudyQuiz();
    applyStudyQuizWidth();
    updateStudySendButton();
    loadSavedQuizzes(currentUser.id);
    loadSavedConversations(currentUser.id);
    updateStudyConversationControls();
    lucide.createIcons();
}

function setStudyPracticeOpen(open, moveFocus = false) {
    studyPracticeOpen = open;
    renderStudyResults();
    renderStudyQuiz();
    if (moveFocus) document.getElementById(open ? "study-quiz-close" : "study-practice-toggle")?.focus();
}

async function loadSavedQuizzes(userId) {
    const runId = ++savedQuizzesLoadRun;
    savedQuizzesLoading = true;
    savedQuizzesError = "";
    renderStudyQuiz();
    try {
        if (!window.supabaseClient) throw new Error("Supabase is not configured.");
        const { data, error } = await window.supabaseClient.from("saved_quizzes")
            .select("id,title,questions,answers,created_at")
            .eq("user_id", userId).order("created_at", { ascending: false });
        if (runId !== savedQuizzesLoadRun || currentUser?.id !== userId) return;
        if (error) throw error;
        const fetched = data || [];
        const fetchedIds = new Set(fetched.map((quiz) => quiz.id));
        savedQuizzes = [
            ...savedQuizzes.filter((quiz) => !fetchedIds.has(quiz.id)),
            ...fetched.map((quiz) => quiz.id === studyQuiz?.id
                ? savedQuizzes.find((local) => local.id === quiz.id) || quiz : quiz)
        ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        if (studyQuiz?.id) {
            const current = savedQuizzes.find((quiz) => quiz.id === studyQuiz.id);
            if (current) {
                studyQuiz = current;
                studyAnswers = current.answers || {};
            }
        }
    } catch (error) {
        if (runId !== savedQuizzesLoadRun || currentUser?.id !== userId) return;
        console.error("Could not load saved quizzes:", error);
        savedQuizzesError = "Could not load your quizzes. Please try again.";
    } finally {
        if (runId === savedQuizzesLoadRun && currentUser?.id === userId) {
            savedQuizzesLoading = false;
            renderStudyQuiz();
        }
    }
}

function renderSavedQuizzes() {
    const list = document.getElementById("study-practice-history");
    if (!list) return;
    list.replaceChildren();
    list.setAttribute("aria-busy", String(savedQuizzesLoading));
    if (savedQuizzesLoading || savedQuizzesError || !savedQuizzes.length) {
        const message = document.createElement("p");
        message.className = "study-course-message";
        message.textContent = savedQuizzesLoading ? "Loading your quizzes…" : savedQuizzesError ||
            "No saved quizzes yet. Ask for a quiz about a topic, your conversation, or an attached file.";
        list.append(message);
        if (savedQuizzesError) {
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "study-retry-button";
            retry.textContent = "Try again";
            retry.addEventListener("click", () => loadSavedQuizzes(currentUser.id));
            list.append(retry);
        }
        if (savedQuizzesLoading || !savedQuizzes.length) return;
    }
    savedQuizzes.forEach((quiz) => {
        const row = document.createElement("article");
        row.className = "study-saved-quiz";
        const header = document.createElement("div");
        header.className = "study-saved-quiz-header";
        const open = document.createElement("button");
        open.type = "button";
        open.className = "study-saved-quiz-open";
        open.disabled = studyQuizMutationPending || studyExplainingQuestions.size > 0;
        const expanded = studyQuiz?.id === quiz.id;
        open.setAttribute("aria-expanded", String(expanded));
        const name = document.createElement("strong");
        name.textContent = quiz.title;
        const progress = document.createElement("span");
        const answers = quiz.answers || {};
        const answered = quiz.questions.filter((question) => Number.isInteger(answers[question.id])).length;
        const wrong = quiz.questions.filter((question) => Number.isInteger(answers[question.id]) &&
            answers[question.id] !== question.correctIndex).length;
        progress.textContent = `${answered}/${quiz.questions.length} answered${wrong ? ` · ${wrong} incorrect` : ""}`;
        const chevron = document.createElement("i");
        chevron.setAttribute("data-lucide", "chevron-down");
        chevron.setAttribute("aria-hidden", "true");
        open.append(name, progress, chevron);
        open.addEventListener("click", () => openSavedQuiz(quiz));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "study-saved-quiz-delete";
        remove.disabled = studyQuizMutationPending || studyExplainingQuestions.size > 0;
        remove.setAttribute("aria-label", `Delete quiz ${quiz.title}`);
        remove.title = "Delete quiz";
        remove.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
        remove.addEventListener("click", () => deleteSavedQuiz(quiz));
        header.append(open, remove);
        const details = document.createElement("div");
        details.id = `study-quiz-details-${quiz.id}`;
        details.className = "study-saved-quiz-details";
        details.hidden = !expanded;
        open.setAttribute("aria-controls", details.id);
        if (expanded) {
            const actions = document.createElement("div");
            actions.className = "study-quiz-actions";
            const reset = document.createElement("button");
            reset.type = "button";
            reset.className = "study-reset-button";
            reset.textContent = "Reset answers";
            reset.disabled = studyQuizMutationPending || studyExplainingQuestions.size > 0 || !Object.keys(studyAnswers).length;
            reset.addEventListener("click", resetStudyQuiz);
            const count = document.createElement("span");
            count.className = "study-quiz-progress";
            count.textContent = `${answered}/${quiz.questions.length} answered`;
            actions.append(reset, count);
            const questions = document.createElement("div");
            questions.className = "study-quiz-list";
            renderStudyQuestions(quiz, questions);
            details.append(actions, questions);
        }
        row.append(header, details);
        list.append(row);
    });
    lucide.createIcons();
}

function openSavedQuiz(quiz) {
    if (studyQuizMutationPending || studyExplainingQuestions.size) return;
    const closing = studyQuiz?.id === quiz.id;
    studyQuiz = closing ? null : quiz;
    studyAnswers = closing ? {} : quiz.answers || {};
    studyPracticeOpen = true;
    renderStudyResults();
    renderStudyQuiz();
    document.querySelector(`[aria-controls="study-quiz-details-${quiz.id}"]`)?.focus({ preventScroll: true });
    updateStudySendButton();
    setStudyStatus("");
}

async function deleteSavedQuiz(quiz) {
    if (studyQuizMutationPending || studyExplainingQuestions.size || !window.confirm(`Delete quiz “${quiz.title}”?`)) return;
    const userId = currentUser?.id;
    if (!userId) return;
    studyQuizMutationPending = true;
    renderStudyQuiz();
    try {
        const { data, error } = await window.supabaseClient.from("saved_quizzes")
            .delete().eq("id", quiz.id).eq("user_id", userId).select("id").single();
        if (currentUser?.id !== userId) return;
        if (error || !data) throw error || new Error("Quiz was not found.");
        savedQuizzes = savedQuizzes.filter((item) => item.id !== quiz.id);
        if (studyQuiz?.id === quiz.id) {
            studyQuiz = null;
            studyAnswers = {};
            [...studyExplainedQuestions].filter((key) => key.startsWith(`${quiz.id}:`))
                .forEach((key) => studyExplainedQuestions.delete(key));
            [...studyExplainingQuestions.keys()].filter((key) => key.startsWith(`${quiz.id}:`))
                .forEach((key) => studyExplainingQuestions.delete(key));
        }
        setStudyStatus("");
        loadSavedQuizzes(userId);
    } catch (error) {
        if (currentUser?.id !== userId) return;
        console.error("Could not delete quiz:", error);
        setStudyStatus("Could not delete this quiz. Please try again.", true);
    } finally {
        if (currentUser?.id !== userId) return;
        studyQuizMutationPending = false;
        renderStudyResults();
        renderStudyQuiz();
        updateStudySendButton();
    }
}

function addStudyFiles(files) {
    if (!files?.length || studyIsSubmitting) return;
    let totalBytes = studyFiles.reduce((total, file) => total + file.size, 0);
    let skipped = 0;
    Array.from(files).forEach((file) => {
        const extension = getFileDetails(file.name).extension.toLowerCase();
        const maxFileBytes = extension === "pdf" ? 10 * 1024 * 1024 : 1024 * 1024;
        if (!["pdf", "txt", "csv"].includes(extension) || !file.size || file.size > maxFileBytes ||
            studyFiles.length >= maxKnowledgeFiles || totalBytes + file.size > maxKnowledgeBatchBytes) {
            skipped += 1;
            return;
        }
        studyFiles.push(file);
        totalBytes += file.size;
    });
    renderStudyFiles();
    setStudyStatus(skipped ? "Some files were skipped. Use up to 8 PDF/TXT/CSV files totaling 12 MB or less." : "", Boolean(skipped));
    const list = document.getElementById("study-file-list");
    if (list) list.scrollLeft = list.scrollWidth;
}

function renderStudyFiles() {
    const list = document.getElementById("study-file-list");
    if (!list) return;
    list.replaceChildren();
    const hasFiles = studyFiles.length > 0;
    list.hidden = !hasFiles;
    document.getElementById("study-browse-files").hidden = hasFiles;
    document.getElementById("study-browse-files").disabled = studyIsSubmitting;
    document.getElementById("study-file-count").textContent = `${studyFiles.length} ${studyFiles.length === 1 ? "file" : "files"} attached`;
    studyFiles.forEach((file, index) => {
        const details = getFileDetails(file.name);
        const card = document.createElement("div");
        card.className = "knowledge-file-card study-file-card";
        card.setAttribute("role", "listitem");
        card.title = file.name;
        const name = document.createElement("p");
        name.className = "knowledge-file-name";
        name.textContent = details.name;
        const extension = document.createElement("span");
        extension.className = "knowledge-file-extension";
        extension.textContent = details.extension;
        const icon = document.createElement("span");
        icon.className = "knowledge-file-icon";
        icon.innerHTML = `<i data-lucide="${getFileIcon(file)}" aria-hidden="true"></i>`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "knowledge-remove-file";
        remove.dataset.removeStudyFile = index;
        remove.disabled = studyIsSubmitting;
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
        card.append(name, extension, icon, remove);
        list.append(card);
    });
    if (hasFiles) {
        const addSlot = document.createElement("div");
        addSlot.setAttribute("role", "listitem");
        const add = document.createElement("button");
        add.id = "study-add-file";
        add.type = "button";
        add.className = "knowledge-add-file study-add-file";
        add.setAttribute("aria-label", "Add more study files");
        add.disabled = studyIsSubmitting || studyFiles.length >= maxKnowledgeFiles;
        add.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i>';
        addSlot.append(add);
        list.append(addSlot);
    }
    lucide.createIcons();
    updateStudySendButton();
}

function updateStudyPromptCount() {
    const counter = document.getElementById("study-request-count");
    if (counter) counter.textContent = `${studyPrompt.length.toLocaleString("en-US")} / 4,000`;
    updateStudySendButton();
}

function updateStudySendButton() {
    const button = document.getElementById("study-send");
    if (!button) return;
    const refersToQuiz = studyPromptTargetsMistakes(studyPrompt) || /this quiz|open quiz|question\s*\d|quiz này|câu\s*(?:hỏi\s*)?\d/iu.test(studyPrompt);
    const activeQuiz = studyPracticeOpen && studyQuiz?.id && (!studyCards.length || refersToQuiz) ? studyQuiz : null;
    const contextNote = document.getElementById("study-context-note");
    if (contextNote) {
        const usesQuizContext = activeQuiz && !studyFiles.length;
        contextNote.textContent = usesQuizContext ? `Using the open quiz “${activeQuiz.title}” as context. No file needed.` : "";
        contextNote.hidden = !usesQuizContext;
    }
    button.disabled = studyIsSubmitting || studyQuizMutationPending || studyConversationPending || !studyPrompt.trim();
}

function setStudyStatus(message, isError = false) {
    const status = document.getElementById("study-status");
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("is-error", isError);
}

function detectStudyMode(prompt) {
    return /\b(quiz|quizz|multiple[ -]?choice|practice exam|mock exam|test me)\b|trắc nghiệm|kiểm tra kiến thức|(?:tạo|soạn|ra|create|generate|make).{0,40}(?:câu hỏi|đề thi|bài kiểm tra|exam|test)/iu.test(prompt)
        ? "quiz" : "study";
}

function studyPromptTargetsMistakes(prompt) {
    return /\b(?:wrong|incorrect|mistakes?|missed)\b|(?:câu|đáp án|trả lời|làm).{0,20}sai|đã sai/iu.test(prompt);
}

function requestedStudyQuizCount(prompt) {
    const patterns = [
        /\b(\d{1,3})\s*(?:câu(?:\s+hỏi)?|questions?|mcqs?)\b/iu,
        /\b(\d{1,3})\s*(?:quiz|quizz|trắc nghiệm)\b/iu,
        /\b(?:quiz|quizz|trắc nghiệm|practice exam|mock exam)\s*(?:(?:gồm|có|với|of|with)\s*)?(\d{1,3})\b/iu,
        /\b(\d{1,3})[ -]?(?:question|câu)[ -]?(?:quiz|quizz|exam)\b/iu
    ];
    const count = patterns.map((pattern) => prompt.match(pattern)?.[1]).find(Boolean);
    return count ? Number(count) : 10;
}

function renderStudyResults() {
    const results = document.getElementById("study-results");
    if (!results) return;
    const hasOutput = studyCards.length > 0;
    const page = document.querySelector(".study-page");
    page.classList.toggle("has-results", hasOutput);
    document.querySelector(".study-heading").hidden = hasOutput;
    document.getElementById("study-clear-cards").hidden = !hasOutput;
    results.hidden = !hasOutput;
    results.replaceChildren();
    for (let index = results.children.length; index < studyCards.length; index += 1) {
        const card = studyCards[index];
        const article = document.createElement("article");
        article.className = "knowledge-analysis-card study-result-card";
        article.dataset.studyCardIndex = String(index);
        article.tabIndex = -1;
        if (card.role === "user" || typeof card.content === "string") {
            article.classList.add(card.role === "user" ? "study-user-message" : "study-assistant-message");
            const label = document.createElement("span");
            label.className = "study-message-role";
            label.textContent = card.role === "user" ? "You" : "CampusFlow";
            const text = document.createElement("div");
            text.className = "study-message-text";
            text.textContent = card.content;
            article.append(label, text);
            if (card.attachments?.length) {
                const attachments = document.createElement("p");
                attachments.className = "study-message-attachments";
                attachments.textContent = `Attached: ${card.attachments.join(", ")}`;
                article.append(attachments);
            }
            results.append(article);
            continue;
        }
        const title = document.createElement("h2");
        title.textContent = card.title;
        const points = document.createElement("ul");
        points.className = "knowledge-analysis-points";
        card.points.forEach((point) => {
            const item = document.createElement("li");
            item.textContent = point;
            points.append(item);
        });
        article.append(title, points);
        results.append(article);
    }
}

function focusNewStudyCard(index) {
    window.requestAnimationFrame(() => {
        const card = document.querySelector(`[data-study-card-index="${index}"]`);
        if (!card) return;
        card.focus({ preventScroll: true });
        card.scrollIntoView({ block: "start", behavior: "smooth" });
    });
}

function clearStudyCards() {
    if (studyConversationPending) return;
    studyRun += 1;
    studyConversationId = null;
    studyConversationTitle = "";
    studyConversationDirty = false;
    studyFiles = [];
    studyPrompt = "";
    studyCards = [];
    studyQuiz = null;
    studyAnswers = {};
    studyExplainedQuestions.clear();
    studyExplainingQuestions.clear();
    studyPracticeOpen = false;
    studyIsSubmitting = false;
    studyIsPreparingQuiz = false;
    const request = document.getElementById("study-request");
    if (request) {
        request.value = "";
        request.disabled = false;
    }
    const fileInput = document.getElementById("study-file-input");
    if (fileInput) fileInput.value = "";
    document.getElementById("study-composer")?.removeAttribute("aria-busy");
    setStudyStatus("");
    renderStudyFiles();
    updateStudyPromptCount();
    renderStudyResults();
    renderStudyQuiz();
    renderSavedConversations();
    updateStudyConversationControls();
    window.scrollTo({ top: 0, behavior: "auto" });
}

function startStudyQuizResize(event) {
    if (event.button !== 0 || window.innerWidth <= 820) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-study-quiz");
    const move = (pointerEvent) => {
        if (pointerEvent.pointerId === event.pointerId) {
            applyStudyQuizWidth(window.innerWidth - pointerEvent.clientX);
        }
    };
    const finish = (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        document.body.classList.remove("is-resizing-study-quiz");
        saveStudyQuizWidth();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
}

function handleStudyQuizResizeKey(event) {
    const { min, max } = studyQuizWidthBounds();
    let width = studyQuizWidthPx;
    if (event.key === "ArrowLeft") width += 24;
    else if (event.key === "ArrowRight") width -= 24;
    else if (event.key === "Home") width = min;
    else if (event.key === "End") width = max;
    else return;
    event.preventDefault();
    applyStudyQuizWidth(width);
    saveStudyQuizWidth();
}

function renderStudyQuiz() {
    const panel = document.getElementById("study-quiz-sidebar");
    if (!panel) return;
    const scrollTop = panel.scrollTop;
    const quizListScroll = document.getElementById("study-practice-history").scrollTop;
    const isVisible = studyPracticeOpen;
    panel.hidden = !isVisible;
    panel.classList.toggle("has-open-quiz", Boolean(studyQuiz?.id));
    panel.querySelector(".study-conversation-history").hidden = Boolean(studyQuiz?.id);
    document.getElementById("study-quiz-resizer").hidden = !isVisible;
    content.classList.toggle("has-study-quiz", isVisible);
    document.getElementById("study-practice-toggle").setAttribute("aria-expanded", String(isVisible));
    document.getElementById("study-quiz-title").textContent = "Practice";
    document.getElementById("study-quiz-loading").hidden = !studyIsPreparingQuiz;
    renderSavedQuizzes();
    renderSavedConversations();
    document.getElementById("study-practice-history").scrollTop = quizListScroll;
    if (isVisible) panel.scrollTop = scrollTop;
    updateStudySendButton();
}

function renderStudyQuestions(quiz, list) {
    quiz.questions.forEach((question, index) => {
        const item = document.createElement("article");
        item.className = "study-question";
        const heading = document.createElement("h3");
        heading.textContent = `${index + 1}. ${question.question}`;
        const choices = document.createElement("div");
        choices.className = "study-choices";
        const chosen = studyAnswers[question.id];
        question.options.forEach((option, optionIndex) => {
            const choice = document.createElement("button");
            choice.type = "button";
            choice.className = "study-choice";
            choice.textContent = `${String.fromCharCode(65 + optionIndex)}. ${option}`;
            choice.disabled = chosen !== undefined || studyQuizMutationPending;
            if (chosen === optionIndex) choice.classList.add(chosen === question.correctIndex ? "is-correct" : "is-wrong");
            choice.addEventListener("click", () => answerStudyQuestion(question.id, optionIndex));
            choices.append(choice);
        });
        item.append(heading, choices);
        if (chosen !== undefined) {
            const feedback = document.createElement("p");
            feedback.className = `study-answer-feedback ${chosen === question.correctIndex ? "is-correct" : "is-wrong"}`;
            feedback.textContent = chosen === question.correctIndex ? "Correct" :
                `Not quite · Correct: ${question.options[question.correctIndex]}`;
            item.append(feedback);
            if (chosen !== question.correctIndex) {
                const explain = document.createElement("button");
                explain.type = "button";
                explain.className = "study-explain-button";
                const explanationKey = `${quiz.id}:${question.id}`;
                const hasExplanation = studyConversationId === quiz.id && studyCards.some((card) =>
                    card.quizId === quiz.id && card.questionId === question.id && card.selectedIndex === chosen);
                explain.textContent = studyExplainingQuestions.has(explanationKey) ? "Explaining…" :
                    hasExplanation ? "View explanation" : "Explain";
                explain.disabled = studyConversationPending || studyIsSubmitting || studyQuizMutationPending;
                explain.addEventListener("click", () => explainStudyQuestion(quiz, question, index, chosen));
                item.append(explain);
            }
        }
        list.append(item);
    });
}

async function explainStudyQuestion(quiz, question, index, chosen) {
    const explanationKey = `${quiz.id}:${question.id}`;
    if (!currentUser || studyConversationPending || studyIsSubmitting || studyQuizMutationPending) return;
    const userId = currentUser.id;
    const runId = studyRun;
    const requestToken = Symbol(explanationKey);
    studyExplainingQuestions.set(explanationKey, requestToken);
    studyIsSubmitting = true;
    renderStudyQuiz();
    const isCurrent = () => currentUser?.id === userId && studyRun === runId &&
        studyQuiz?.id === quiz.id && studyExplainingQuestions.get(explanationKey) === requestToken;
    try {
        // Reuse the quiz UUID in the separate conversations table as a stable
        // one-to-one key. This survives reloads without a new database column.
        if (studyConversationId !== quiz.id) {
            if (studyConversationDirty) {
                await persistStudyConversation();
                if (!isCurrent() || studyConversationDirty) return;
            }
            const { data, error } = await window.supabaseClient.from("saved_conversations")
                .select("id,title,messages").eq("id", quiz.id).eq("user_id", userId);
            if (!isCurrent()) return;
            if (error) throw error;
            const conversation = data?.[0];
            if (conversation && !validStudyMessages(conversation.messages)) {
                throw new Error("The saved explanation conversation could not be read.");
            }
            studyConversationId = quiz.id;
            studyConversationTitle = conversation?.title || `${quiz.title} · Explanations`.slice(0, 100);
            studyCards = conversation?.messages || [];
            studyConversationDirty = false;
            renderStudyResults();
        }
        const existingIndex = studyCards.findIndex((card) => card.quizId === quiz.id &&
            card.questionId === question.id && card.selectedIndex === chosen);
        if (existingIndex !== -1) {
            focusNewStudyCard(existingIndex);
            if (studyConversationDirty) await persistStudyConversation();
            return;
        }
        let explanationPoints = question.explanation.split(/(?<=[.!?。])\s+|\n+/u)
            .map((part) => part.trim()).filter(Boolean);
        if (question.explanation.length < 160) {
            try {
                const payload = new FormData();
                payload.append("mode", "study");
                payload.append("prompt", `Explain question ${index + 1} in one clear card with 4 to 6 bullet points. Teach the concept step by step, explain why the correct choice is right and why my chosen option is wrong. Do not invent facts.`);
                payload.append("quizContext", JSON.stringify({
                    title: quiz.title,
                    questions: [{ id: question.id, question: question.question, options: question.options,
                        correctIndex: question.correctIndex }],
                    wrongQuestions: [{ id: question.id, selectedIndex: chosen }]
                }));
                const { data, error } = await window.supabaseClient.functions.invoke("study-assistant", { body: payload });
                if (error) throw error;
                if (!Array.isArray(data?.cards) || !data.cards.length || data.cards.some((card) =>
                    !Array.isArray(card?.points) || card.points.some((point) => typeof point !== "string"))) {
                    throw new Error("The study service returned an incomplete explanation.");
                }
                explanationPoints = data.cards.flatMap((card) => card.points).slice(0, 8);
            } catch (error) {
                console.warn("Could not expand quiz explanation; using the saved explanation:", error);
            }
        }
        if (!isCurrent()) return;
        const firstNewCard = studyCards.length;
        studyCards.push({
            title: `${quiz.title} · Question ${index + 1}: ${question.question}`,
            points: [
                `Your answer: ${question.options[chosen]}`,
                `Correct answer: ${question.options[question.correctIndex]}`,
                ...explanationPoints
            ],
            quizId: quiz.id,
            questionId: question.id,
            selectedIndex: chosen
        });
        studyExplainedQuestions.add(explanationKey);
        renderStudyResults();
        renderStudyQuiz();
        focusNewStudyCard(firstNewCard);
        await persistStudyConversation();
    } catch (error) {
        console.error("Could not open quiz explanation:", error);
        if (isCurrent()) setStudyStatus("Could not open this explanation. Please try again.", true);
    } finally {
        if (currentUser?.id === userId && studyRun === runId) {
            studyExplainingQuestions.delete(explanationKey);
            studyIsSubmitting = false;
            renderStudyQuiz();
            updateStudyConversationControls();
        }
    }
}

async function answerStudyQuestion(questionId, optionIndex) {
    if (!studyQuiz?.id || studyQuizMutationPending || studyAnswers[questionId] !== undefined) return;
    const userId = currentUser?.id;
    if (!userId) return;
    const quizId = studyQuiz.id;
    const answers = { ...studyAnswers, [questionId]: optionIndex };
    studyQuizMutationPending = true;
    renderStudyQuiz();
    try {
        const { data, error } = await window.supabaseClient.from("saved_quizzes")
            .update({ answers, updated_at: new Date().toISOString() })
            .eq("id", quizId).eq("user_id", userId).select("id").single();
        if (currentUser?.id !== userId) return;
        if (error || !data) throw error || new Error("Quiz was not found.");
        const saved = savedQuizzes.find((quiz) => quiz.id === quizId);
        if (saved) saved.answers = answers;
        if (studyQuiz?.id === quizId) studyAnswers = answers;
        setStudyStatus("");
    } catch (error) {
        if (currentUser?.id !== userId) return;
        console.error("Could not save quiz answer:", error);
        setStudyStatus("Could not save your answer. Please try again.", true);
    } finally {
        if (currentUser?.id !== userId) return;
        studyQuizMutationPending = false;
        renderStudyQuiz();
    }
}

async function resetStudyQuiz() {
    if (!studyQuiz?.id || studyQuizMutationPending || studyExplainingQuestions.size || !Object.keys(studyAnswers).length) return;
    const userId = currentUser?.id;
    if (!userId) return;
    const quizId = studyQuiz.id;
    studyQuizMutationPending = true;
    renderStudyQuiz();
    try {
        const { data, error } = await window.supabaseClient.from("saved_quizzes")
            .update({ answers: {}, updated_at: new Date().toISOString() })
            .eq("id", quizId).eq("user_id", userId).select("id").single();
        if (currentUser?.id !== userId) return;
        if (error || !data) throw error || new Error("Quiz was not found.");
        const saved = savedQuizzes.find((quiz) => quiz.id === quizId);
        if (saved) saved.answers = {};
        if (studyQuiz?.id === quizId) {
            studyAnswers = {};
            [...studyExplainedQuestions].filter((key) => key.startsWith(`${quizId}:`))
                .forEach((key) => studyExplainedQuestions.delete(key));
            [...studyExplainingQuestions.keys()].filter((key) => key.startsWith(`${quizId}:`))
                .forEach((key) => studyExplainingQuestions.delete(key));
        }
        setStudyStatus("");
    } catch (error) {
        if (currentUser?.id !== userId) return;
        console.error("Could not reset quiz:", error);
        setStudyStatus("Could not reset this quiz. Please try again.", true);
    } finally {
        if (currentUser?.id !== userId) return;
        studyQuizMutationPending = false;
        renderStudyResults();
        renderStudyQuiz();
    }
}

function studyConversationHistory() {
    const history = [];
    let remaining = 60000;
    for (const card of studyCards.slice(-40).reverse()) {
        const text = (typeof card.content === "string" ? card.content :
            `${card.title}\n${card.points.join("\n")}`).slice(0, 16000);
        if (!text.trim()) continue;
        if (text.length > remaining) break;
        history.unshift({ role: card.role === "user" ? "user" : "assistant", content: text });
        remaining -= text.length;
    }
    return history;
}

function updateStudyConversationControls() {
    const request = document.getElementById("study-request");
    if (request) request.disabled = studyConversationPending || studyIsSubmitting;
    const retry = document.getElementById("study-retry-save");
    if (retry) {
        retry.hidden = !studyConversationDirty;
        retry.disabled = studyConversationPending || studyIsSubmitting;
    }
    const add = document.getElementById("study-new-conversation");
    if (add) add.disabled = studyConversationPending || studyIsSubmitting;
    const clear = document.getElementById("study-clear-cards");
    if (clear) clear.disabled = studyConversationPending;
    updateStudySendButton();
}

async function loadSavedConversations(userId) {
    const run = ++savedConversationsLoadRun;
    savedConversationsLoading = true;
    savedConversationsError = "";
    renderSavedConversations();
    try {
        const { data, error } = await window.supabaseClient.from("saved_conversations")
            .select("id,title,updated_at").eq("user_id", userId).order("updated_at", { ascending: false });
        if (run !== savedConversationsLoadRun || currentUser?.id !== userId) return;
        if (error) throw error;
        savedConversations = data || [];
    } catch (error) {
        if (run !== savedConversationsLoadRun || currentUser?.id !== userId) return;
        console.error("Could not load conversations:", error);
        savedConversationsError = "Could not load conversations. Please try again.";
    } finally {
        if (run === savedConversationsLoadRun && currentUser?.id === userId) {
            savedConversationsLoading = false;
            renderSavedConversations();
        }
    }
}

function renderSavedConversations() {
    const list = document.getElementById("study-conversation-list");
    if (!list) return;
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    list.setAttribute("aria-busy", String(savedConversationsLoading));
    if (savedConversationsLoading || savedConversationsError || !savedConversations.length) {
        const message = document.createElement("p");
        message.className = "study-course-message";
        message.textContent = savedConversationsLoading ? "Loading conversations…" : savedConversationsError ||
            "No saved conversations yet. Ask about any topic to start one.";
        list.append(message);
        if (savedConversationsError) {
            const retry = document.createElement("button");
            retry.type = "button";
            retry.className = "study-retry-button";
            retry.textContent = "Try again";
            retry.addEventListener("click", () => loadSavedConversations(currentUser.id));
            list.append(retry);
        }
    }
    if (!savedConversationsLoading) savedConversations.forEach((conversation) => {
        const row = document.createElement("article");
        row.className = "study-saved-quiz study-saved-conversation";
        const header = document.createElement("div");
        header.className = "study-saved-quiz-header";
        const open = document.createElement("button");
        open.type = "button";
        open.className = "study-saved-quiz-open";
        open.disabled = studyConversationPending || studyIsSubmitting;
        open.setAttribute("aria-current", String(conversation.id === studyConversationId));
        const title = document.createElement("strong");
        title.textContent = conversation.title;
        const date = document.createElement("span");
        date.textContent = new Date(conversation.updated_at).toLocaleString();
        const icon = document.createElement("i");
        icon.setAttribute("data-lucide", "message-circle");
        open.append(title, date, icon);
        open.addEventListener("click", () => openStudyConversation(conversation.id));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "study-saved-quiz-delete";
        remove.disabled = studyConversationPending || studyIsSubmitting;
        remove.setAttribute("aria-label", `Delete conversation ${conversation.title}`);
        remove.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
        remove.addEventListener("click", () => deleteStudyConversation(conversation));
        header.append(open, remove);
        row.append(header);
        list.append(row);
    });
    list.scrollTop = scrollTop;
    updateStudyConversationControls();
    lucide.createIcons();
}

async function persistStudyConversation() {
    if (!currentUser || studyConversationPending || !studyCards.length) return;
    const userId = currentUser.id;
    const run = studyRun;
    studyConversationId ||= crypto.randomUUID();
    studyConversationTitle ||= (studyCards.find((card) => card.role === "user")?.content ||
        studyCards[0].title || "Study conversation").replace(/\s+/g, " ").slice(0, 100);
    const snapshot = { id: studyConversationId, user_id: userId, title: studyConversationTitle,
        messages: structuredClone(studyCards), updated_at: new Date().toISOString() };
    studyConversationPending = true;
    studyConversationDirty = true;
    savedConversationsLoadRun += 1;
    savedConversationsLoading = false;
    renderSavedConversations();
    try {
        const { data, error } = await window.supabaseClient.from("saved_conversations")
            .upsert(snapshot, { onConflict: "id" }).select("id,title,updated_at").single();
        if (currentUser?.id !== userId || run !== studyRun) return;
        if (error || !data) throw error || new Error("No conversation returned.");
        savedConversationsLoadRun += 1;
        savedConversationsLoading = false;
        savedConversations = [data, ...savedConversations.filter((item) => item.id !== data.id)];
        savedConversationsError = "";
        studyConversationDirty = false;
        setStudyStatus("");
    } catch (error) {
        if (currentUser?.id !== userId || run !== studyRun) return;
        console.error("Could not save conversation:", error);
        setStudyStatus("Your response is shown, but the conversation could not be saved. Use Retry save before leaving.", true);
    } finally {
        if (currentUser?.id === userId && run === studyRun) {
            studyConversationPending = false;
            renderSavedConversations();
            updateStudyConversationControls();
        }
    }
}

function newStudyConversation() {
    if (studyConversationPending || studyIsSubmitting) return;
    if (studyConversationDirty && !window.confirm("This conversation has unsaved changes. Start a new one anyway?")) return;
    clearStudyCards();
    setStudyPracticeOpen(true);
    document.getElementById("study-request")?.focus();
}

function validStudyMessages(messages) {
    return Array.isArray(messages) && messages.every((card) => card &&
        (card.role === undefined || card.role === "user" || card.role === "assistant") &&
        (typeof card.content === "string" || (typeof card.title === "string" && Array.isArray(card.points) &&
        card.points.every((point) => typeof point === "string"))) &&
        (card.attachments === undefined || (Array.isArray(card.attachments) && card.attachments.every((name) => typeof name === "string"))));
}

async function openStudyConversation(id) {
    if (studyConversationPending || studyIsSubmitting || id === studyConversationId) return;
    if (studyConversationDirty && !window.confirm("This conversation has unsaved changes. Open another one anyway?")) return;
    const userId = currentUser?.id;
    if (!userId) return;
    const run = studyRun;
    studyConversationPending = true;
    renderSavedConversations();
    try {
        const { data, error } = await window.supabaseClient.from("saved_conversations")
            .select("id,title,messages").eq("id", id).eq("user_id", userId).single();
        if (currentUser?.id !== userId || studyRun !== run) return;
        if (error || !data || !validStudyMessages(data.messages)) throw error || new Error("Conversation is unavailable.");
        studyConversationPending = false;
        clearStudyCards();
        studyConversationId = data.id;
        studyConversationTitle = data.title;
        studyCards = data.messages;
        studyPracticeOpen = true;
        renderStudyResults();
        renderStudyQuiz();
        focusNewStudyCard(Math.max(0, studyCards.length - 1));
    } catch (error) {
        if (currentUser?.id !== userId || studyRun !== run) return;
        console.error("Could not open conversation:", error);
        setStudyStatus("Could not open this conversation. Please try again.", true);
    } finally {
        if (currentUser?.id === userId) {
            studyConversationPending = false;
            renderSavedConversations();
        }
    }
}

async function deleteStudyConversation(conversation) {
    if (studyConversationPending || studyIsSubmitting || !currentUser) return;
    if (!window.confirm(`Delete conversation “${conversation.title}”? Saved quizzes will be kept.`)) return;
    const userId = currentUser.id;
    const run = studyRun;
    studyConversationPending = true;
    savedConversationsLoadRun += 1;
    savedConversationsLoading = false;
    renderSavedConversations();
    try {
        const { data, error } = await window.supabaseClient.from("saved_conversations")
            .delete().eq("id", conversation.id).eq("user_id", userId).select("id").single();
        if (currentUser?.id !== userId || studyRun !== run) return;
        if (error || !data) throw error || new Error("Conversation was not found.");
        savedConversationsLoadRun += 1;
        savedConversationsLoading = false;
        savedConversations = savedConversations.filter((item) => item.id !== conversation.id);
        studyConversationPending = false;
        if (studyConversationId === conversation.id) {
            clearStudyCards();
            setStudyPracticeOpen(true);
        }
    } catch (error) {
        console.error("Could not delete conversation:", error);
        if (currentUser?.id === userId && studyRun === run) setStudyStatus("Could not delete this conversation. Please try again.", true);
    } finally {
        if (currentUser?.id === userId) {
            studyConversationPending = false;
            renderSavedConversations();
        }
    }
}

async function sendStudyRequest() {
    if (studyIsSubmitting || studyQuizMutationPending || studyConversationPending || !currentUser || !studyPrompt.trim()) return;
    const filesToSend = [...studyFiles];
    const prompt = studyPrompt.trim();
    const history = studyConversationHistory();
    const targetsMistakes = studyPromptTargetsMistakes(prompt);
    const refersToQuiz = targetsMistakes || /this quiz|open quiz|question\s*\d|quiz này|câu\s*(?:hỏi\s*)?\d/iu.test(prompt);
    const activeQuiz = studyPracticeOpen && studyQuiz?.id && (!history.length || refersToQuiz) ? studyQuiz : null;
    const detectedMode = detectStudyMode(prompt);
    const mode = detectedMode === "quiz" ? "quiz" : !filesToSend.length && !activeQuiz ? "chat" : "study";
    const wrongQuestions = activeQuiz ? activeQuiz.questions.filter((question) =>
        studyAnswers[question.id] !== undefined && studyAnswers[question.id] !== question.correctIndex) : [];
    if (activeQuiz && !filesToSend.length && targetsMistakes && !wrongQuestions.length) {
        setStudyStatus("The open quiz has no incorrect answers yet. Answer some questions first, or ask about the quiz generally.", true);
        return;
    }
    const runId = ++studyRun;
    const userId = currentUser.id;
    let firstNewCard = null;
    let newQuizCreated = false;
    const userCard = { role: "user", content: prompt, attachments: filesToSend.map((file) => file.name) };
    studyCards.push(userCard);
    const wrongIds = new Set(wrongQuestions.map((question) => question.id));
    const quizContext = !filesToSend.length && activeQuiz ? {
        title: activeQuiz.title,
        wrongQuestions: wrongQuestions.map((question) => ({
            id: question.id,
            selectedIndex: studyAnswers[question.id],
            selectedAnswer: question.options[studyAnswers[question.id]],
            correctAnswer: question.options[question.correctIndex]
        })),
        questions: (targetsMistakes ? wrongQuestions : activeQuiz.questions).map((question) => ({
            id: question.id,
            question: question.question,
            options: question.options,
            correctIndex: question.correctIndex,
            explanation: typeof question.explanation === "string"
                ? question.explanation.slice(0, wrongIds.has(question.id) ? 600 : 250) : ""
        }))
    } : null;
    studyIsSubmitting = true;
    studyIsPreparingQuiz = mode === "quiz";
    if (mode === "quiz") studyPracticeOpen = true;
    renderStudyResults();
    renderStudyQuiz();
    renderStudyFiles();
    updateStudyConversationControls();
    document.getElementById("study-request").disabled = true;
    document.getElementById("study-composer").setAttribute("aria-busy", "true");
    setStudyStatus(mode === "quiz" ? "Creating your quiz…" : "Thinking…");
    try {
        const payload = new FormData();
        filesToSend.forEach((file) => payload.append("file", file, file.name));
        payload.append("prompt", prompt);
        payload.append("mode", mode);
        payload.append("history", JSON.stringify(history));
        if (quizContext) payload.append("quizContext", JSON.stringify(quizContext));
        const { data, error } = await window.supabaseClient.functions.invoke("study-assistant", { body: payload });
        if (runId !== studyRun || currentUser?.id !== userId) return;
        if (error) throw error;
        if (mode === "quiz") {
            const quiz = data?.quiz;
            const expectedCount = Number.isInteger(data?.requestedCount) && data.requestedCount >= 1 && data.requestedCount <= 30
                ? data.requestedCount : requestedStudyQuizCount(prompt);
            if (!quiz || typeof quiz.title !== "string" || !Array.isArray(quiz.questions)) {
                throw new Error("The study service did not return a quiz. Redeploy the latest study-assistant Edge Function.");
            }
            if (quiz.questions.length !== expectedCount) {
                throw new Error(`The study service returned ${quiz.questions.length} of ${expectedCount} requested questions. Redeploy the latest study-assistant Edge Function, then try again.`);
            }
            const invalidQuestion = quiz.questions.findIndex((question) => !question || typeof question.id !== "string" ||
                    !question.id.trim() || typeof question.question !== "string" || !question.question.trim() ||
                    !Array.isArray(question.options) || question.options.length !== 4 ||
                    question.options.some((option) => typeof option !== "string" || !option.trim()) ||
                    !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3 ||
                    typeof question.explanation !== "string" || !question.explanation.trim());
            if (invalidQuestion !== -1) {
                throw new Error(`Question ${invalidQuestion + 1} is missing an answer or explanation. Redeploy the latest study-assistant Edge Function, then try again.`);
            }
            const { data: savedQuiz, error: saveError } = await window.supabaseClient.from("saved_quizzes")
                .insert({ user_id: userId, title: quiz.title, questions: quiz.questions, answers: {} })
                .select("id,title,questions,answers,created_at").single();
            if (runId !== studyRun || currentUser?.id !== userId) return;
            if (saveError || !savedQuiz) throw new Error(`Could not save the new quiz: ${saveError?.message || "No row returned."}`);
            savedQuizzesLoading = false;
            savedQuizzesError = "";
            savedQuizzes.unshift(savedQuiz);
            studyQuiz = savedQuiz;
            studyAnswers = {};
            newQuizCreated = true;
            firstNewCard = studyCards.length;
            studyCards.push({ role: "assistant", content: `Created “${savedQuiz.title}” with ${savedQuiz.questions.length} questions. You can practice it in Saved quizzes.`, quizId: savedQuiz.id });
        } else if (mode === "chat") {
            if (typeof data?.reply !== "string" || !data.reply.trim()) {
                throw new Error("The study service did not return a conversation reply. Redeploy the latest study-assistant Edge Function.");
            }
            firstNewCard = studyCards.length;
            studyCards.push({ role: "assistant", content: data.reply });
        } else {
            if (!Array.isArray(data?.cards) || !data.cards.length || data.cards.some((card) =>
                typeof card?.title !== "string" || !Array.isArray(card.points) || !card.points.length ||
                card.points.some((point) => typeof point !== "string"))) {
                throw new Error("The study service returned incomplete study cards.");
            }
            firstNewCard = studyCards.length;
            studyCards.push(...data.cards);
        }
        studyFiles = studyFiles.filter((file) => !filesToSend.includes(file));
        studyPrompt = "";
        const request = document.getElementById("study-request");
        if (request) request.value = "";
        setStudyStatus("");
        renderStudyResults();
        await persistStudyConversation();
    } catch (error) {
        if (runId !== studyRun) return;
        // Keep the prompt for retry, without duplicating a failed user turn in history.
        const userIndex = studyCards.indexOf(userCard);
        if (userIndex !== -1 && firstNewCard === null) studyCards.splice(userIndex, 1);
        console.error("Study request failed:", error);
        setStudyStatus(await getKnowledgeAnalysisErrorMessage(error), true);
    } finally {
        if (runId !== studyRun) return;
        studyIsSubmitting = false;
        studyIsPreparingQuiz = false;
        document.getElementById("study-request")?.removeAttribute("disabled");
        document.getElementById("study-composer")?.removeAttribute("aria-busy");
        renderStudyFiles();
        updateStudyPromptCount();
        renderStudyResults();
        renderStudyQuiz();
        updateStudyConversationControls();
        if (newQuizCreated) {
            const historyList = document.getElementById("study-practice-history");
            if (historyList) historyList.scrollTop = 0;
        }
        if (firstNewCard !== null) focusNewStudyCard(firstNewCard);
    }
}

function clearStudyWorkspace() {
    studyRun += 1;
    savedConversationsLoadRun += 1;
    savedConversations = [];
    savedConversationsLoading = false;
    savedConversationsError = "";
    studyConversationId = null;
    studyConversationTitle = "";
    studyConversationDirty = false;
    studyConversationPending = false;
    savedQuizzesLoadRun += 1;
    studyFiles = [];
    studyPrompt = "";
    studyCards = [];
    studyQuiz = null;
    studyAnswers = {};
    studyExplainedQuestions = new Set();
    studyExplainingQuestions = new Map();
    studyPracticeOpen = false;
    savedQuizzes = [];
    savedQuizzesLoading = false;
    savedQuizzesError = "";
    studyQuizMutationPending = false;
    studyIsSubmitting = false;
    studyIsPreparingQuiz = false;
}

function showKnowledgePage() {
    content.innerHTML = `
        <section class="knowledge-page" aria-labelledby="knowledge-title">
            <div id="knowledge-heading" class="knowledge-heading">
                <div class="knowledge-heading-icon" aria-hidden="true"><i data-lucide="library"></i></div>
                <h1 id="knowledge-title">Course Knowledge</h1>
                <p>Keep your course files, syllabus, and important learning materials together.</p>
            </div>
            <section id="knowledge-analysis-results" class="knowledge-analysis-results" aria-live="polite" hidden></section>
            <div class="knowledge-composer">
                <div class="knowledge-composer-inner">
                    <div id="knowledge-dropzone" class="knowledge-dropzone" role="button" tabindex="0" aria-label="Attach course files" aria-describedby="knowledge-upload-help">
                        <input id="knowledge-file-input" type="file" accept=".pdf,.txt,.csv" multiple hidden>
                        <div id="knowledge-empty-state" class="knowledge-empty-state">
                            <span class="knowledge-upload-icon" aria-hidden="true"><i data-lucide="paperclip"></i></span>
                            <span id="knowledge-upload-help">Attach PDF, TXT or CSV files (8 max, 12 MB total)</span>
                        </div>
                        <div id="knowledge-file-list" class="knowledge-file-list" aria-label="Selected course files" hidden></div>
                    </div>
                    <div class="knowledge-analysis-actions">
                        <button id="knowledge-analyze-button" class="knowledge-analyze-button" type="button" disabled><i data-lucide="sparkles"></i> Analyze selected files</button>
                        <p id="knowledge-analysis-status" class="sr-only" role="status" aria-live="polite"></p>
                    </div>
                </div>
            </div>
        </section>
    `;

    lucide.createIcons();

    const dropzone = document.getElementById("knowledge-dropzone");
    const fileInput = document.getElementById("knowledge-file-input");
    dropzone.addEventListener("click", (event) => {
        if (knowledgeIsAnalyzing) return;
        const removeButton = event.target.closest(".knowledge-remove-file");
        if (removeButton) {
            knowledgeFiles.splice(Number(removeButton.dataset.fileIndex), 1);
            renderKnowledgeFiles();
            return;
        }

        if (!knowledgeFiles.length || event.target.closest("#knowledge-add-file")) {
            fileInput.click();
        }
    });
    dropzone.addEventListener("keydown", (event) => {
        if (knowledgeIsAnalyzing) return;
        if (event.target.closest("button")) return;

        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInput.click();
        }
    });
    fileInput.addEventListener("change", () => addKnowledgeFiles(fileInput.files));
    document.getElementById("knowledge-analyze-button").addEventListener("click", analyzeKnowledgeFiles);
    ["dragenter", "dragover"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropzone.classList.add("is-dragging");
        });
    });
    ["dragleave", "drop"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropzone.classList.remove("is-dragging");
        });
    });
    dropzone.addEventListener("drop", (event) => addKnowledgeFiles(event.dataTransfer.files));

    renderKnowledgeFiles();
    renderKnowledgeAnalyses();
}

function addKnowledgeFiles(files) {
    if (knowledgeIsAnalyzing) return;
    const newFiles = Array.from(files);
    if (!newFiles.length) return;

    let totalBytes = knowledgeFiles.reduce((total, file) => total + file.size, 0);
    let acceptedCount = 0;
    const supportedFiles = newFiles.filter((file) => {
        const extension = file.name.split(".").pop()?.toLowerCase();
        const valid = ["pdf", "txt", "csv"].includes(extension) && file.size > 0 &&
            file.size <= (extension === "pdf" ? 10 : 1) * 1024 * 1024 &&
            knowledgeFiles.length + acceptedCount < maxKnowledgeFiles &&
            totalBytes + file.size <= maxKnowledgeBatchBytes;
        if (valid) {
            totalBytes += file.size;
            acceptedCount += 1;
        }
        return valid;
    });
    if (supportedFiles.length) knowledgeFiles = knowledgeFiles.concat(supportedFiles);
    document.getElementById("knowledge-file-input").value = "";
    renderKnowledgeFiles();
    if (supportedFiles.length !== newFiles.length) {
        setKnowledgeAnalysisStatus("Some files were skipped. Choose up to 8 PDF/TXT/CSV files totaling 12 MB or less.", true);
    } else {
        setKnowledgeAnalysisStatus("");
    }
}

function getFileDetails(fileName) {
    const lastDotIndex = fileName.lastIndexOf(".");
    if (lastDotIndex <= 0) return { name: fileName, extension: "FILE" };

    return {
        name: fileName.slice(0, lastDotIndex),
        extension: fileName.slice(lastDotIndex + 1).toUpperCase()
    };
}

function getFileIcon(file) {
    const extension = getFileDetails(file.name).extension.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension)) return "image";
    if (["mp4", "mov", "webm"].includes(extension)) return "video";
    if (["mp3", "wav", "m4a"].includes(extension)) return "music-2";
    if (["ppt", "pptx", "key"].includes(extension)) return "presentation";
    if (["xls", "xlsx", "csv"].includes(extension)) return "sheet";
    return "file-text";
}

function renderKnowledgeFiles() {
    const fileList = document.getElementById("knowledge-file-list");
    const emptyState = document.getElementById("knowledge-empty-state");
    if (!fileList || !emptyState) return;

    fileList.replaceChildren();
    emptyState.hidden = knowledgeFiles.length > 0;
    fileList.hidden = knowledgeFiles.length === 0;
    document.getElementById("knowledge-dropzone").classList.toggle("has-files", knowledgeFiles.length > 0);
    const analyzeButton = document.getElementById("knowledge-analyze-button");
    if (analyzeButton) analyzeButton.disabled = knowledgeIsAnalyzing || knowledgeFiles.length === 0;

    knowledgeFiles.forEach((file, index) => {
        const details = getFileDetails(file.name);
        const card = document.createElement("article");
        card.className = "knowledge-file-card";
        card.title = file.name;

        const name = document.createElement("p");
        name.className = "knowledge-file-name";
        name.textContent = details.name;

        const extension = document.createElement("span");
        extension.className = "knowledge-file-extension";
        extension.textContent = details.extension;

        const icon = document.createElement("span");
        icon.className = "knowledge-file-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = `<i data-lucide="${getFileIcon(file)}"></i>`;

        const removeButton = document.createElement("button");
        removeButton.className = "knowledge-remove-file";
        removeButton.type = "button";
        removeButton.disabled = knowledgeIsAnalyzing;
        removeButton.dataset.fileIndex = index;
        removeButton.setAttribute("aria-label", `Remove ${file.name}`);
        removeButton.innerHTML = '<i data-lucide="x"></i>';

        card.append(name, extension, icon, removeButton);
        fileList.append(card);
    });

    if (knowledgeFiles.length) {
        const addButton = document.createElement("button");
        addButton.id = "knowledge-add-file";
        addButton.className = "knowledge-add-file";
        addButton.type = "button";
        addButton.disabled = knowledgeIsAnalyzing;
        addButton.setAttribute("aria-label", "Add more course files");
        addButton.innerHTML = '<i data-lucide="plus"></i>';
        fileList.append(addButton);
    }

    lucide.createIcons();
}

function setKnowledgeAnalysisStatus(message, isError = false) {
    const status = document.getElementById("knowledge-analysis-status");
    if (!status) return;
    status.textContent = message;
    const button = document.getElementById("knowledge-analyze-button");
    if (button) {
        button.classList.toggle("has-error", isError);
        button.title = isError ? message : "";
    }
}

function createKnowledgeAnalysisCard(analysis) {
    const { courseName, keyPoints, smallDetails = [], schedule, coursePeriod } = analysis;
    const article = document.createElement("article");
    article.className = "knowledge-analysis-card";
    const header = document.createElement("div");
    header.className = "knowledge-card-header";
    const title = document.createElement("h2");
    title.textContent = courseName;
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "knowledge-save-button";
    saveButton.textContent = analysis.saved ? "Saved" : "Save this course";
    saveButton.disabled = Boolean(analysis.saved);
    saveButton.addEventListener("click", () => saveCourse(analysis, saveButton));
    header.append(title, saveButton);
    const facts = document.createElement("div");
    facts.className = "knowledge-course-facts";
    const scheduleLine = document.createElement("p");
    scheduleLine.textContent = `Schedule: ${schedule || "Not specified"}`;
    const periodLine = document.createElement("p");
    periodLine.textContent = `Course period: ${coursePeriod || "Not specified"}`;
    facts.append(scheduleLine, periodLine);
    const points = document.createElement("ul");
    points.className = "knowledge-analysis-points";
    keyPoints.forEach((point) => {
        const item = document.createElement("li");
        item.textContent = point;
        points.append(item);
    });
    article.append(header, facts, points);
    if (smallDetails.length) {
        const detailsHeading = document.createElement("h3");
        detailsHeading.textContent = "Details worth noting";
        const detailsList = document.createElement("ul");
        detailsList.className = "knowledge-analysis-details";
        smallDetails.forEach((detail) => {
            const item = document.createElement("li");
            item.textContent = detail;
            detailsList.append(item);
        });
        article.append(detailsHeading, detailsList);
    }
    return article;
}

async function saveCourse(analysis, button) {
    const userId = currentUser?.id;
    if (!userId || !window.supabaseClient) {
        button.textContent = "Sign in to save";
        button.title = "Sign in before saving a course.";
        return;
    }
    button.disabled = true;
    button.textContent = "Saving…";
    const { data, error } = await window.supabaseClient.from("saved_courses").upsert({
        user_id: userId,
        course_name: analysis.courseName,
        schedule: analysis.schedule || null,
        course_period: analysis.coursePeriod || null,
        key_points: analysis.keyPoints,
        small_details: analysis.smallDetails || [],
        updated_at: new Date().toISOString()
    }, { onConflict: "user_id,course_name" }).select("id").single();
    if (currentUser?.id !== userId) return;
    if (error) {
        console.error("Could not save course:", error);
        button.disabled = false;
        button.textContent = "Retry save";
        button.title = "Could not save this course. Please try again.";
        return;
    }
    analysis.savedId = data.id;
    analysis.saved = true;
    button.textContent = "Saved";
    button.title = "Course saved to your Dashboard.";
}

function renderKnowledgeAnalyses() {
    const results = document.getElementById("knowledge-analysis-results");
    if (!results) return;
    results.replaceChildren();
    const hasResults = knowledgeAnalyses.length + knowledgePreviousAnalyses.length > 0;
    results.hidden = !hasResults;
    document.getElementById("knowledge-heading").hidden = hasResults;
    document.querySelector(".knowledge-page")?.classList.toggle("has-results", hasResults);

    if (!hasResults) return;

    const actions = document.createElement("div");
    actions.className = "knowledge-results-actions";
    let previousResults = null;
    if (knowledgePreviousAnalyses.length) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "knowledge-history-toggle";
        toggle.setAttribute("aria-controls", "knowledge-previous-results");
        previousResults = document.createElement("section");
        previousResults.id = "knowledge-previous-results";
        previousResults.className = "knowledge-previous-results";
        knowledgePreviousAnalyses.forEach((analysis) => previousResults.append(createKnowledgeAnalysisCard(analysis)));
        const updateToggle = () => {
            toggle.textContent = `${showPreviousKnowledgeAnalyses ? "Hide" : "Show"} previous cards (${knowledgePreviousAnalyses.length})`;
            toggle.setAttribute("aria-expanded", String(showPreviousKnowledgeAnalyses));
            previousResults.hidden = !showPreviousKnowledgeAnalyses;
        };
        toggle.addEventListener("click", () => {
            showPreviousKnowledgeAnalyses = !showPreviousKnowledgeAnalyses;
            updateToggle();
        });
        updateToggle();
        actions.append(toggle);
    }
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "knowledge-clear-button";
    clearButton.textContent = "Clear";
    clearButton.setAttribute("aria-label", "Clear all course cards and selected files");
    clearButton.addEventListener("click", () => {
        clearKnowledgeWorkspace();
        window.scrollTo({ top: 0, behavior: "auto" });
    });
    actions.append(clearButton);
    results.append(actions);
    if (previousResults) results.append(previousResults);
    knowledgeAnalyses.forEach((analysis) => results.append(createKnowledgeAnalysisCard(analysis)));
}

function clearKnowledgeWorkspace() {
    knowledgeAnalysisRun += 1;
    knowledgeFiles = [];
    knowledgeAnalyses = [];
    knowledgePreviousAnalyses = [];
    showPreviousKnowledgeAnalyses = false;
    knowledgeIsAnalyzing = false;
    const fileInput = document.getElementById("knowledge-file-input");
    if (fileInput) fileInput.value = "";
    renderKnowledgeFiles();
    renderKnowledgeAnalyses();
    const button = document.getElementById("knowledge-analyze-button");
    button?.classList.remove("is-analyzing");
    button?.removeAttribute("aria-busy");
    setKnowledgeAnalysisStatus("");
}

async function getKnowledgeAnalysisErrorMessage(error) {
    const response = error?.context;
    if (response instanceof Response) {
        let body = null;
        try {
            body = await response.clone().json();
        } catch {
            // Only use known status/code values; never render backend error text.
        }
        if (response.status === 401) return "Please sign in again to continue.";
        if (response.status === 403) return "You cannot access this content with your current account.";
        if (response.status === 400) return "Please check your request and attached files, then try again.";
        if (response.status === 413) return "Your files are too large. Please attach smaller files.";
        if (response.status === 422) return "We could not use this material. Please try different files or a different request.";
        if (response.status === 429) {
            const messages = {
                minute_limit: "You have reached the AI limit for this minute.",
                daily_limit: "You have reached today's AI limit. It resets at midnight UTC.",
                concurrent_limit: "Please wait for one of your current AI tasks to finish."
            };
            const message = typeof body?.code === "string" && Object.hasOwn(messages, body.code)
                ? messages[body.code] : "AI is busy right now.";
            const seconds = Number(body?.retryAfterSeconds || response.headers.get("Retry-After"));
            const wait = Number.isFinite(seconds) && seconds > 0 && seconds <= 86400
                ? ` Try again in about ${seconds < 60 ? `${Math.ceil(seconds)} seconds` : `${Math.ceil(seconds / 60)} minutes`}.`
                : " Please try again later.";
            return `${message}${wait}`;
        }
        if (response.status === 504) return "This request took too long. Please try a smaller request.";
    }
    return "Something went wrong. Please try again in a moment.";
}

async function analyzeKnowledgeFiles() {
    if (knowledgeIsAnalyzing || !knowledgeFiles.length) return;
    if (!currentUser) {
        setKnowledgeAnalysisStatus("Please sign in before analyzing files.", true);
        return;
    }
    if (!window.supabaseClient) {
        setKnowledgeAnalysisStatus("File analysis is temporarily unavailable. Please try again later.", true);
        return;
    }

    const button = document.getElementById("knowledge-analyze-button");
    const runId = ++knowledgeAnalysisRun;
    const userId = currentUser.id;
    knowledgeIsAnalyzing = true;
    button.classList.add("is-analyzing");
    button.setAttribute("aria-busy", "true");
    renderKnowledgeFiles();
    try {
        const filesToAnalyze = [...knowledgeFiles];
        setKnowledgeAnalysisStatus(`Analyzing ${filesToAnalyze.length} selected files…`);
        const courseKey = (name) => name.normalize("NFKC").trim().toLocaleLowerCase();
        const uniquePoints = (points) => {
            const seen = new Set();
            return points.filter((point) => {
                const key = courseKey(point);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        };
        let savedRows = [];
        try {
            const { data, error } = await window.supabaseClient
                .from("saved_courses")
                .select("id,course_name,schedule,course_period,key_points,small_details")
                .eq("user_id", userId);
            if (error) console.warn("Could not read saved courses before analysis:", error);
            else savedRows = data || [];
        } catch (error) {
            console.warn("Could not read saved courses before analysis:", error);
        }
        if (runId !== knowledgeAnalysisRun || currentUser?.id !== userId) return;
        const savedCards = savedRows.filter((row) => typeof row.course_name === "string").map((row) => ({
            courseName: row.course_name,
            keyPoints: Array.isArray(row.key_points) ? row.key_points.filter((point) => typeof point === "string") : [],
            smallDetails: Array.isArray(row.small_details) ? row.small_details.filter((detail) => typeof detail === "string") : [],
            schedule: row.schedule,
            coursePeriod: row.course_period,
            savedId: row.id
        }));
        const previousCards = [...knowledgeAnalyses, ...knowledgePreviousAnalyses];
        const knownCourseNames = [...new Map([...previousCards, ...savedCards]
            .map(({ courseName }) => [courseKey(courseName), courseName])).values()];
        const payload = new FormData();
        filesToAnalyze.forEach((file) => payload.append("file", file, file.name));
        payload.append("knownCourses", JSON.stringify(knownCourseNames));
        const { data, error } = await window.supabaseClient.functions.invoke("analyze-course-file", { body: payload });
        if (runId !== knowledgeAnalysisRun || currentUser?.id !== userId) return;
        if (error) throw error;
        if (!Array.isArray(data?.courses) || data.courses.length === 0) {
            throw new Error("The analysis service returned no course summaries.");
        }

        const courses = data.courses.map((course) => {
            if (typeof course?.courseName !== "string" || !Array.isArray(course.keyPoints) ||
                course.keyPoints.some((point) => typeof point !== "string")) {
                throw new Error("The analysis service returned an invalid course summary.");
            }
            const courseName = course.courseName.trim();
            const keyPoints = course.keyPoints.map((point) => point.trim());
            const smallDetails = Array.isArray(course.smallDetails) ? course.smallDetails : [];
            if (!courseName || keyPoints.some((point) => !point) ||
                smallDetails.some((detail) => typeof detail !== "string" || !detail.trim())) {
                throw new Error("The analysis service returned an incomplete course summary.");
            }
            return {
                courseName,
                keyPoints,
                smallDetails: smallDetails.map((detail) => detail.trim()),
                schedule: typeof course.schedule === "string" ? course.schedule.trim() || null : null,
                coursePeriod: typeof course.coursePeriod === "string" ? course.coursePeriod.trim() || null : null
            };
        });
        const latestCards = [];
        courses.forEach(({ courseName, keyPoints, smallDetails, schedule, coursePeriod }) => {
            const key = courseKey(courseName);
            const current = latestCards.find((item) => courseKey(item.courseName) === key);
            const earlier = current || previousCards.find((item) => courseKey(item.courseName) === key);
            const saved = savedCards.find((item) => courseKey(item.courseName) === key);
            const merged = {
                courseName,
                keyPoints: uniquePoints([...(saved?.keyPoints || []), ...(earlier?.keyPoints || []), ...keyPoints]),
                smallDetails: uniquePoints([...(saved?.smallDetails || []), ...(earlier?.smallDetails || []), ...smallDetails]),
                schedule: schedule || earlier?.schedule || saved?.schedule || null,
                coursePeriod: coursePeriod || earlier?.coursePeriod || saved?.coursePeriod || null,
                savedId: earlier?.savedId || saved?.savedId || null,
                saved: false
            };
            if (!merged.keyPoints.length && !merged.smallDetails.length && !merged.schedule && !merged.coursePeriod) {
                throw new Error("The analysis service returned no useful course information.");
            }
            if (current) Object.assign(current, merged);
            else latestCards.push(merged);
        });
        const latestCourseKeys = new Set(latestCards.map((item) => courseKey(item.courseName)));
        knowledgePreviousAnalyses = previousCards.filter((item) => !latestCourseKeys.has(courseKey(item.courseName)));
        knowledgeAnalyses = latestCards;
        showPreviousKnowledgeAnalyses = false;
        knowledgeFiles = knowledgeFiles.filter((file) => !filesToAnalyze.includes(file));
        renderKnowledgeFiles();
        renderKnowledgeAnalyses();
        document.getElementById("knowledge-analysis-results")?.scrollIntoView({ block: "start" });
        setKnowledgeAnalysisStatus("Analysis complete.");
    } catch (error) {
        if (runId !== knowledgeAnalysisRun) return;
        console.error("Course file analysis failed:", error);
        const message = await getKnowledgeAnalysisErrorMessage(error);
        if (runId === knowledgeAnalysisRun) setKnowledgeAnalysisStatus(message, true);
    } finally {
        if (runId !== knowledgeAnalysisRun) return;
        knowledgeIsAnalyzing = false;
        button.classList.remove("is-analyzing");
        button.removeAttribute("aria-busy");
        renderKnowledgeFiles();
    }
}

function showAccountPage() {
    activePage = "account";
    content.classList.remove("has-dashboard", "has-study", "has-study-quiz");
    if (!currentUser) {
        showGuestPage("account");
        return;
    }

    const fullName = escapeHTML(getFullName());
    const email = escapeHTML(currentUser.email || "");

    content.innerHTML = `
        <section class="account-page" aria-labelledby="account-title">
            <div class="account-avatar" aria-hidden="true"><i data-lucide="user-round"></i></div>
            <h1 id="account-title">${fullName}</h1>
            <p class="account-email">${email}</p>
            <div class="account-settings">
                <form id="name-form" class="account-form">
                    <h2>Change name</h2>
                    <label for="account-fullname">Full name</label>
                    <input id="account-fullname" name="fullname" type="text" value="${fullName}" autocomplete="name" required>
                    <button class="account-save" type="submit">Save name</button>
                    <p class="account-status" role="status" aria-live="polite"></p>
                </form>
                <form id="password-form" class="account-form">
                    <h2>Change password</h2>
                    <label for="new-password">New password</label>
                    <input id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" required>
                    <label for="confirm-new-password">Confirm new password</label>
                    <input id="confirm-new-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>
                    <button class="account-save" type="submit">Update password</button>
                    <p class="account-status" role="status" aria-live="polite"></p>
                </form>
            </div>
            <button id="signout-button" class="signout-button" type="button">Sign Out</button>
        </section>
    `;

    lucide.createIcons();
    document.getElementById("name-form").addEventListener("submit", updateName);
    document.getElementById("password-form").addEventListener("submit", updatePassword);
    document.getElementById("signout-button").addEventListener("click", signOut);
}

function setFormStatus(form, message, isError = false) {
    const status = form.querySelector(".account-status");
    status.textContent = message;
    status.classList.toggle("is-error", isError);
    status.classList.toggle("is-success", !isError && Boolean(message));
}

async function updateName(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const fullName = new FormData(form).get("fullname").trim();

    button.disabled = true;
    setFormStatus(form, "Saving...");
    const { data, error } = await window.supabaseClient.auth.updateUser({ data: { full_name: fullName } });
    button.disabled = false;

    if (error) {
        console.error("Could not update profile:", error);
        setFormStatus(form, "Could not update your name. Please try again.", true);
        return;
    }

    currentUser = data.user;
    updateNavbar();
    document.getElementById("account-title").textContent = getFullName();
    setFormStatus(form, "Name updated successfully.");
}

async function updatePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const formData = new FormData(form);
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");

    if (password !== confirmPassword) {
        setFormStatus(form, "Passwords do not match.", true);
        return;
    }

    button.disabled = true;
    setFormStatus(form, "Updating password...");
    const { error } = await window.supabaseClient.auth.updateUser({ password });
    button.disabled = false;

    if (error) {
        console.error("Could not update password:", error);
        setFormStatus(form, "Could not update your password. Please try again or sign in again.", true);
        return;
    }

    form.reset();
    setFormStatus(form, "Password updated successfully.");
}

async function signOut() {
    const button = document.getElementById("signout-button");
    button.disabled = true;
    const { error } = await window.supabaseClient.auth.signOut();

    if (error) {
        button.disabled = false;
        console.error("Could not sign out:", error);
        setFormStatus(document.getElementById("name-form"), "Could not sign out. Please try again.", true);
        return;
    }

    currentUser = null;
    savedCourses = [];
    dashboardLoadRun += 1;
    clearStudyWorkspace();
    clearKnowledgeWorkspace();
    updateNavbar();
    showPage("dashboard");
}

sidebarItems.forEach((item) => {
    item.addEventListener("click", () => {
        sidebarItems.forEach((sidebarItem) => sidebarItem.classList.remove("active"));
        item.classList.add("active");
        showPage(item.dataset.page);
    });
});

navbarProfile.addEventListener("click", () => {
    sidebarItems.forEach((sidebarItem) => {
        sidebarItem.classList.toggle("active", sidebarItem.dataset.page === "account");
    });
    showAccountPage();
});

function handleSignIn() {
    window.location.href = "sign_in.html";
}

function handleSignUp() {
    window.location.href = "sign_up.html";
}

async function initializeAuth() {
    if (!window.isSupabaseConfigured || !window.supabaseClient) {
        updateNavbar();
        showPage("dashboard");
        return;
    }

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    currentUser = session?.user || null;
    updateNavbar();
    showPage("dashboard");

    window.supabaseClient.auth.onAuthStateChange((_event, session) => {
        const nextUser = session?.user || null;
        const identityChanged = currentUser?.id !== nextUser?.id;
        if (identityChanged) {
            clearKnowledgeWorkspace();
            clearStudyWorkspace();
            savedCourses = [];
            dashboardLoadRun += 1;
        }
        currentUser = nextUser;
        updateNavbar();
        if (identityChanged) showPage(activePage);
    });
}

initializeAuth();
