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
    replyPreview.classList.remove("show");
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

// Typing indicator — pings the server at most once every 1.5s while
// actively typing, rather than on every single keystroke.
let lastTypingPing = 0;

messageInput.addEventListener("input", function () {
    const now = Date.now();
    if (now - lastTypingPing < 1500) return;
    lastTypingPing = now;

    const formData = new FormData();
    formData.append("chatwith", chatWith);

    fetch("/typing", { method: "POST", body: formData }).catch(() => {});
});

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

    // Older messages (sent before this feature existed) won't have
    // a reply_to_id — only make the preview clickable when we
    // actually know which message to jump to.
    const clickAttr = msg.reply_to_id
        ? `onclick="jumpToMessage('${msg.reply_to_id}')" style="cursor:pointer;"`
        : "";

    return `
        <div class="reply-box" ${clickAttr}>
            <div style="color:#b998ff;font-weight:bold;margin-bottom:4px;">
                ${msg.reply_self ? "Replying to yourself" : "Replying"}
            </div>
            <div>${escapeHTML(msg.reply_text)}</div>
        </div>
    `;
}

function jumpToMessage(id) {
    const target = document.querySelector(`.bubble[data-id="${id}"]`);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("highlight");

    setTimeout(function () {
        target.classList.remove("highlight");
    }, 1200);
}

function buildTicks(msg) {
    // Only your own outgoing messages show ticks — there's no
    // reason to show delivery status on messages you received.
    if (msg.sender !== username) return "";

    return msg.seen
        ? `<span class="ticks seen">✓✓</span>`
        : `<span class="ticks">✓</span>`;
}

function buildBubble(msg) {
    const bubble = document.createElement("div");

    bubble.className = msg.sender === username ? "bubble me" : "bubble other";
    bubble.dataset.id = msg.id;

    bubble.innerHTML = `
        ${buildReplyHTML(msg)}
        <div class="message-text">${escapeHTML(msg.text)}</div>
        <div class="msg-time">
            <span class="time-text">${msg.edited ? "edited • " : ""}${msg.time || ""}</span>
            ${buildTicks(msg)}
        </div>
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

const SWIPE_THRESHOLD = 55;
const SWIPE_MAX = 80;

function attachLongPress(bubble, message) {
    // Desktop
    bubble.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        showMenu(message, e.pageX, e.pageY);
    });

    // Mobile — long press opens the menu, a horizontal swipe
    // triggers reply. touchmove decides which gesture is happening:
    // once movement is clearly more horizontal than vertical, the
    // long-press timer is cancelled and the bubble starts tracking
    // the swipe instead.
    let timer;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let swiped = false;

    bubble.addEventListener("touchstart", function (e) {
        startX = e.touches[0].pageX;
        startY = e.touches[0].pageY;
        dragging = false;
        swiped = false;

        timer = setTimeout(function () {
            showMenu(message, e.touches[0].pageX, e.touches[0].pageY);
        }, LONG_PRESS_TIME);
    });

    bubble.addEventListener("touchmove", function (e) {
        const deltaX = e.touches[0].pageX - startX;
        const deltaY = e.touches[0].pageY - startY;

        if (!dragging) {
            // Not yet committed to a gesture — decide based on which
            // direction has moved further so far.
            if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
                dragging = true;
                clearTimeout(timer);
            } else if (Math.abs(deltaY) > 10) {
                // Clearly scrolling vertically — this isn't a swipe,
                // let the page scroll normally.
                clearTimeout(timer);
                return;
            } else {
                return;
            }
        }

        // Only allow swiping right (WhatsApp-style reply gesture),
        // clamped to a max distance so it doesn't fly off screen.
        const clamped = Math.max(0, Math.min(deltaX, SWIPE_MAX));

        e.preventDefault();
        bubble.style.transform = `translateX(${clamped}px)`;
        bubble.style.setProperty("--swipe-progress", clamped / SWIPE_THRESHOLD);

        swiped = clamped >= SWIPE_THRESHOLD;
    });

    bubble.addEventListener("touchend", function () {
        clearTimeout(timer);

        bubble.style.transform = "";
        bubble.style.setProperty("--swipe-progress", 0);

        if (dragging && swiped) {
            selectedMessage = message;
            replyMessage();
        }

        dragging = false;
        swiped = false;
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
    replyPreview.classList.add("show");

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
        formData.append("reply_to_id", replyingTo.id);
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

// ---------- TYPING INDICATOR DISPLAY ----------

const statusEl = document.querySelector(".status");
const originalStatusHTML = statusEl ? statusEl.innerHTML : "";

async function checkTypingStatus() {
    if (!statusEl) return;

    try {
        const response = await fetch(
            `/typing_status?chatwith=${encodeURIComponent(chatWith)}`,
            { cache: "no-store" }
        );

        const data = await response.json();

        statusEl.innerHTML = data.typing
            ? `<span class="typing-text">typing...</span>`
            : originalStatusHTML;

    } catch (error) {
        console.log("Typing status check failed:", error);
    }
}

function startSync() {
    setInterval(async function () {
        if (loading) return;
        await loadMessages();
        checkTypingStatus();
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
