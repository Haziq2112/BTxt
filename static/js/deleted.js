function loadDeletedUsers() {

    fetch("/admin/deleted/list")

    .then(response => response.text())

    .then(html => {

        document.getElementById("deleted-list").innerHTML = html;

    })

    .catch(error => {

        console.log(error);

    });

}

function adminAction(url) {

    fetch(url, {
        method: "POST"
    })

    .then(response => response.json())

    .then(data => {

        loadDeletedUsers();

    })

    .catch(error => {

        console.log(error);

    });

}

let deleteForeverUser = "";

function showDeletePopup(username) {

    deleteForeverUser = username;

    document.getElementById("deleteForeverText").innerText =
        "Are you sure you want to permanently delete '" +
        username +
        "'?\n\nThis action cannot be undone.";

    document.getElementById("deleteForeverPopup").style.display =
        "flex";

}

function closeDeletePopup() {

    document.getElementById("deleteForeverPopup").style.display =
        "none";

}

function confirmDeleteForever() {

    adminAction(
        "/admin/deleteforever/" +
        encodeURIComponent(deleteForeverUser)
    );

    closeDeletePopup();

}

loadDeletedUsers();

setInterval(loadDeletedUsers, 5000);
