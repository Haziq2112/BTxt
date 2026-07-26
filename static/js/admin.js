let action = "";
let user = "";

function showPopup(act, username) {

    action = act;
    user = username;

    let text = "";

    switch (act) {

        case "delete":
            text = "Delete " + username + "?";
            break;

        case "deleteforever":
            text = "Delete " + username + " forever?";
            break;

        case "suspend":
            text = "Suspend " + username + "?";
            break;

        case "resume":
            text = "Resume " + username + "?";
            break;

        case "banip":
            text = "Ban IP of " + username + "?";
            break;

        case "unbanip":
            text = "Unban IP of " + username + "?";
            break;

        default:
            text = "Are you sure?";
    }

    document.getElementById("popupText").innerText = text;

    document.getElementById("popup").style.display = "flex";

}

function closePopup() {

    document.getElementById("popup").style.display = "none";

}

function confirmAction() {

    fetch("/admin/" + action + "/" + user, {

        method: "POST"

    })

    .then(response => response.json())

    .then(data => {

        closePopup();

        loadAdmin();

        if (typeof loadDeletedUsers === "function") {

            loadDeletedUsers();

        }

    })

    .catch(error => {

        console.log(error);

        alert("Server error");

    });

}

function adminAction(url) {

    fetch(url, {
        method: "POST"
    })

    .then(response => response.json())

    .then(data => {

        closePopup();
        loadAdmin();

    })

    .catch(err => {

        alert("Something went wrong");
        console.log(err);

    });

}

function searchUsers() {

    let input = document.getElementById("searchInput");
    let filter = input.value.toLowerCase();
    let cards = document.getElementsByClassName("card");

    for (let i = 0; i < cards.length; i++) {

        let text = cards[i].innerText || cards[i].textContent;

        if (cards[i].querySelector("h3")) {

            if (text.toLowerCase().includes(filter)) {

                cards[i].style.display = "";

            } else {

                cards[i].style.display = "none";

            }

        }

    }

}

function loadAdmin() {

    fetch("/admin/content")

    .then(response => response.text())

    .then(html => {

        document.getElementById("admin-content").innerHTML = html;

    })

    .catch(error => {

        console.log(error);

    });

}

setInterval(loadAdmin, 5000);
