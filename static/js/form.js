async function submitForm(options) {

    const form = document.getElementById(options.formId);

    form.addEventListener("submit", async function (e) {

        e.preventDefault();

        document.querySelectorAll(".error-text").forEach(el => {
            el.textContent = "";
        });
        const button = form.querySelector("button[type='submit']");
        const originalText = button.textContent;
        const formData = new FormData(form);
        
        if (options.loadingText) {
            button.textContent = options.loadingText;
        }

        button.disabled = true;

        const response = await fetch(options.url, {
            method: "POST",
            body: formData
        });
        const data = await response.json();

        if (data.success) {

            button.disabled = true;

            setTimeout(() => {

                window.location.href = data.redirect;

            }, 1000);

             return;

        }

        button.textContent = originalText;

        if (typeof updateSignupButton === "function") {

            updateSignupButton();

        }

        else if (typeof updateLoginButton === "function") {

            updateLoginButton();

        }

        else {

            button.disabled = false;

        }

        const error = document.getElementById(data.field + "Error");

        if (error) {

            error.textContent = data.message;

        }

    });

}

