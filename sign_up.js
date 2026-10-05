const signupForm = document.getElementById("signup-form");
const statusElement = document.getElementById("signup-status");
const submitButton = signupForm.querySelector('button[type="submit"]');

function showStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("is-error", isError);
    statusElement.classList.toggle("is-success", !isError && Boolean(message));
}

signupForm.addEventListener("submit", async function(event) {
    event.preventDefault();

    const formData = new FormData(signupForm);
    const fullName = formData.get("fullname").trim();
    const email = formData.get("email").trim();
    const password = formData.get("password");
    const confirmPassword = formData.get("confirm-password");

    if (password !== confirmPassword) {
        showStatus("Passwords do not match.", true);
        return;
    }

    submitButton.disabled = true;
    showStatus("Creating your account...");

    const options = {
        data: {
            full_name: fullName
        }
    };

    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
        options.emailRedirectTo = new URL("index.html", window.location.href).href;
    }

    const { data, error } = await window.supabaseClient.auth.signUp({
        email,
        password,
        options
    });

    submitButton.disabled = false;

    if (error) {
        console.error("Could not create account:", error);
        showStatus("Could not create your account. Please check your details and try again.", true);
        return;
    }

    if (data.session) {
        showStatus("Account created. Redirecting...");
        window.location.assign("index.html");
        return;
    }

    signupForm.reset();
    showStatus("Check your email to confirm your account, then sign in.");
});
