const signinForm = document.getElementById("signin-form");
const statusElement = document.getElementById("signin-status");
const submitButton = signinForm.querySelector('button[type="submit"]');

function showStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.classList.toggle("is-error", isError);
    statusElement.classList.toggle("is-success", !isError && Boolean(message));
}

signinForm.addEventListener("submit", async function(event) {
    event.preventDefault();

    const formData = new FormData(signinForm);
    const email = formData.get("email").trim();
    const password = formData.get("password");

    submitButton.disabled = true;
    showStatus("Signing in...");

    const { error } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    submitButton.disabled = false;

    if (error) {
        showStatus("Unable to sign in. Check your email and password, then try again.", true);
        return;
    }

    showStatus("Signed in successfully. Redirecting...");
    window.location.assign("index.html");
});
