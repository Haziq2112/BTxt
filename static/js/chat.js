"use strict";

// =====================================
// BText V4 — Chat Page Logic
// =====================================

// ---------- USER ----------
const username = usernameValue;
const chatWith = chatWithValue;

// ---------- DOM ----------
const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const scrollBtn = document.getElementById("scrollBtn");
const msgMenu = document.getElementById("msgMenu");
const replyPreview = document.getElementById("replyPreview");
const replyTitle = document.getElementById("replyTitle");
const replyText = document.getElementById("replyText");
const editModal = document.getElementById("editModal");
const editInput = document.getElementById("editInput");

// ---------- STATE ----------
let selectedMessage = null;
let replyingTo = null;
let editingMessageId = null;
let lastServerHash = "";
let sending = false;
let loading = false;

// ---------- SETTINGS ----------
const REFRESH_RATE = 700;
const LONG_PRESS_TIME = 500;
const BOTTOM_DISTANCE = 60;

// =====================================
// HELPERS
// =====================================

function isAtBottom() {
    return (
        chatBox.scrollTop + chatBox.clientHeight >=
        chatBox.scrollHeight - BOTTOM_DISTANCE
    );
}

function scrollToBottom() {
    chatBox.scrollTop = chatBox.scrollHeight;
    scrollBtn.style.display = "none";
}

function autoResizeInput() {
    messageInput.style.height = "48px";
    messageInput.style.height = messageInput.scrollHeight + "px";
}

function closeMenu() {
    msgMenu.style.display = "none";
}

function closeEditModal() {
    editModal.style.display = "none";
}

function cancelReply() {
    replyingTo = null;
    replyPreview.style.display = "none";
}

function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

// =====================================
// EVENTS
// =====================================

messageInput.addEventListener("input", autoResizeInput);

chatBox.addEventListener("scroll", () => {
    scrollBtn.style.display = isAtBottom() ? "none" : "block";
});

scrollBtn.addEventListener("click", scrollToBottom);

document.addEventListener("click", closeMenu);

// Mobile browsers don't reliably resize position:fixed elements around
// the on-screen keyboard. The VisualViewport API fires whenever the
// keyboard opens/closes, so we use it to reposition the input bar,
// chat area, and scroll button to sit exactly above the keyboard
// instead of jumping or getting hidden behind it.
if (window.visualViewport) {

    function handleViewportChange() {
        const keyboardHeight = Math.max(
            0,
            window.innerHeight - window.visualViewport.height
        );

        chatForm.style.bottom = (14 + keyboardHeight) + "px";
        chatBox.style.bottom = (92 + keyboardHeight) + "px";
        scrollBtn.style.bottom = (100 + keyboardHeight) + "px";

        if (isAtBottom()) {
            scrollToBottom();
        }
    }

    window.visualViewport.addEventListener("resize", handleViewportChange);
    window.visualViewport.addEventListener("scroll", handleViewportChange);
}

// =====================================
// RENDERING ENGINE
// =====================================

function buildReplyHTML(msg) {
    if (!msg.reply_text) return "";

    return `
        <div class="reply-box">
            <div style="color:#b998ff;font-weight:bold;margin-bottom:4px;">
                ${msg.reply_self ? "Replying to yourself" : "Replying"}
            </div>
            <div>${escapeHTML(msg.reply_text)}</div>
        </div>
    `;
}

function buildBubble(msg) {
    const bubble = document.createElement("div");

    bubble.className = msg.sender === username ? "bubble me" : "bubble other";
    bubble.dataset.id = msg.id;

    bubble.innerHTML = `
        ${buildReplyHTML(msg)}
        <div class="message-text">${escapeHTML(msg.text)}</div>
        <div class="msg-time">${msg.edited ? "edited • " : ""}${msg.time || ""}</div>
    `;

    attachLongPress(bubble, msg);

    return bubble;
}

function renderMessages(messages) {
    const stayBottom = isAtBottom();
    const existing = {};

    document.querySelectorAll(".bubble").forEach(bubble => {
        existing[bubble.dataset.id] = bubble;
    });

    messages.forEach(msg => {
        if (msg.deleted) return;

        if (!msg.deleted_for) {
            msg.deleted_for = [];
        }

        if (msg.deleted_for.some(u => u.toLowerCase() === username.toLowerCase())) {
            return;
        }

        // Already rendered → refresh its content in case it was edited
        if (existing[msg.id]) {
            const oldBubble = existing[msg.id];
            const newBubble = buildBubble(msg);
            oldBubble.replaceWith(newBubble);
            delete existing[msg.id];
            return;
        }

        // New message → append it
        chatBox.appendChild(buildBubble(msg));
    });

    // Remove bubbles for messages that no longer exist / were deleted
    Object.values(existing).forEach(bubble => bubble.remove());

    if (stayBottom) {
        scrollToBottom();
    }
}

// =====================================
// LOADING ENGINE
// =====================================

async function loadMessages(force = false) {
    console.log("loadMessages called");

    if (loading) return;
    loading = true;

    try {
        const response = await fetch(
            `/messages?username=${encodeURIComponent(username)}&chatwith=${encodeURIComponent(chatWith)}`,
            { cache: "no-store" }
        );

        if (!response.ok) {
            console.log("Load Error: bad response status", response.status);
            return;
        }

        const data = await response.json();
        const hash = JSON.stringify(data.messages);

        if (force) {
            lastServerHash = "";
        }

        if (hash !== lastServerHash) {
            lastServerHash = hash;
            renderMessages(data.messages);
        }
    } catch (error) {
        console.log("Load Error:", error);
    } finally {
        loading = false;
    }
}

// =====================================
// LONG PRESS + MENU
// =====================================

function showMenu(message, x, y) {
    selectedMessage = message;

    document.getElementById("editBtn").style.display =
        message.sender === username ? "block" : "none";

    document.getElementById("deleteBtn").style.display =
        message.sender === username ? "block" : "none";

    msgMenu.style.display = "flex";
    msgMenu.style.left = x + "px";
    msgMenu.style.top = y + "px";
}

function attachLongPress(bubble, message) {
    // Desktop
    bubble.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        showMenu(message, e.pageX, e.pageY);
    });

    // Mobile
    let timer;

    bubble.addEventListener("touchstart", function (e) {
        timer = setTimeout(function () {
            showMenu(message, e.touches[0].pageX, e.touches[0].pageY);
        }, LONG_PRESS_TIME);
    });

    bubble.addEventListener("touchend", function () {
        clearTimeout(timer);
    });
}

// =====================================
// COPY
// =====================================

function copyMessage() {
    if (!selectedMessage) return;

    const text = selectedMessage.text;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
    } else {
        const temp = document.createElement("textarea");
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
    }

    closeMenu();
}

// =====================================
// REPLY
// =====================================

function replyMessage() {
    if (!selectedMessage) return;

    replyingTo = selectedMessage;
    replyPreview.style.display = "block";

    replyTitle.innerText =
        selectedMessage.sender === username ? "Replying to yourself" : "Replying";

    replyText.innerText = selectedMessage.text;

    closeMenu();
}

// =====================================
// EDIT + DELETE
// =====================================

function editMessage() {
    if (!selectedMessage) return;

    editingMessageId = selectedMessage.id;
    editInput.value = selectedMessage.text;
    editModal.style.display = "block";

    closeMenu();
}

async function saveEditMessage() {
    const newText = editInput.value.trim();
    if (newText === "") return;

    await fetch("/edit_message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: username,
            chatwith: chatWith,
            message_id: editingMessageId,
            new_text: newText
        })
    });

    closeEditModal();
    loadMessages(true);
}

async function deleteMessage() {
    if (!selectedMessage) return;

    await fetch("/delete_message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: username,
            message_id: selectedMessage.id,
            mode: "everyone"
        })
    });

    closeMenu();
    loadMessages(true);
}

async function deleteForMe() {
    if (!selectedMessage) return;

    await fetch("/delete_message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: username,
            message_id: selectedMessage.id,
            mode: "me"
        })
    });

    closeMenu();
    loadMessages(true);
}

// =====================================
// SEND + STARTUP
// =====================================

chatForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    console.log("chatForm submit fired at", new Date().toISOString());

    // Guard against firing twice in a row — without this, two
    // near-simultaneous submit events (e.g. a stray Enter keydown
    // landing right after a button tap) could send the same
    // message twice.
    if (sending) {
        console.log("submit ignored — already sending");
        return;
    }

    const text = messageInput.value.trim();
    if (text === "") return;

    sending = true;

    const formData = new FormData();
    formData.append("username", username);
    formData.append("chatwith", chatWith);
    formData.append("message", text);

    if (replyingTo) {
        formData.append("reply_text", replyingTo.text);
        formData.append("reply_self", replyingTo.sender === username);
    }

    // Keep keyboard open
    messageInput.focus();

    // Clear immediately
    messageInput.value = "";
    autoResizeInput();
    cancelReply();

    try {
        await fetch("/send", {
            method: "POST",
            body: formData
        });

        // Refresh immediately after successful send
        await loadMessages(true);
        scrollToBottom();
    } catch (err) {
        console.log(err);
    }

    sending = false;
});

// Enter to send
messageInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        console.log("Enter-to-send triggered at", new Date().toISOString());
        e.preventDefault();
        chatForm.requestSubmit();
    }
});

function startSync() {
    setInterval(async function () {
        if (loading) return;
        await loadMessages();
    }, REFRESH_RATE);

    // Mobile browsers throttle/pause setInterval when the tab isn't
    // actively focused (screen lock, app switch, background tab).
    // Force a fresh load whenever the page becomes visible/focused again.
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            loadMessages(true);
        }
    });

    window.addEventListener("focus", function () {
        loadMessages(true);
    });
}

// ---------- START ----------
window.addEventListener("load", function () {
    loadMessages(true);
    scrollToBottom();
    startSync();
});

// Some mobile browsers restore previously-typed (but never sent) form
// field values when navigating back to a page — this guarantees the
// message box and any pending reply are always wiped clean on arrival,
// regardless of what the browser tries to restore.
window.addEventListener("pageshow", function () {
    messageInput.value = "";
    autoResizeInput();
    cancelReply();
});
