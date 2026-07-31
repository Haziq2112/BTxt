"use strict";

// =====================================
// BTxt V4 — Chat Page Logic
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
let latestMessages = [];

// Selection mode (copy/delete multiple)
let selectionMode = false;
let selectedMessages = new Map();

// Pinned messages
let pinnedMessagesList = [];
let currentPinnedIndex = 0;

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

function buildReactionChips(msg) {
    if (!msg.reactions || msg.reactions.length === 0) return "";

    // Group by emoji, counting how many people used each one
    const counts = {};
    let mine = null;

    msg.reactions.forEach(r => {
        counts[r.emoji] = (counts[r.emoji] || 0) + 1;
        if (r.username === username) mine = r.emoji;
    });

    const chips = Object.entries(counts).map(([emoji, count]) => {
        const mineClass = emoji === mine ? "mine" : "";
        return `<span class="reaction-chip ${mineClass}">${emoji} ${count}</span>`;
    }).join("");

    return `<div class="reaction-chips">${chips}</div>`;
}

function buildBubble(msg) {
    const bubble = document.createElement("div");

    bubble.className = msg.sender === username ? "bubble me" : "bubble other";
    bubble.dataset.id = msg.id;

    if (selectionMode && selectedMessages.has(msg.id)) {
        bubble.classList.add("selected");
    }

    bubble.innerHTML = `
        ${buildReplyHTML(msg)}
        <div class="message-text">${escapeHTML(msg.text)}</div>
        <div class="msg-time">
            ${msg.pinned ? '<span class="pin-icon">📌</span>' : ""}
            <span class="time-text">${msg.edited ? "edited • " : ""}${msg.time || ""}</span>
            ${buildTicks(msg)}
        </div>
        ${buildReactionChips(msg)}
    `;

    attachLongPress(bubble, msg);

    if (selectionMode) {
        bubble.addEventListener("click", function () {
            toggleSelection(bubble, msg);
        });
    }

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
            latestMessages = data.messages;
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

const SWIPE_THRESHOLD = 55;
const SWIPE_MAX = 80;
const MENU_MARGIN = 10;

function showMenu(message, x, y) {
    selectedMessage = message;

    document.getElementById("editBtn").style.display =
        message.sender === username ? "block" : "none";

    document.getElementById("deleteBtn").style.display =
        message.sender === username ? "block" : "none";

    document.getElementById("pinBtn").innerText =
        message.pinned ? "📌 Unpin" : "📌 Pin";

    const customInput = document.getElementById("customEmojiInput");
    customInput.style.display = "none";
    customInput.value = "";

    // Measure the menu off-screen first so we know its real size
    // before deciding where to place it — this is what keeps it
    // fully inside the viewport no matter where you long-press,
    // instead of running off the bottom/side of the screen.
    msgMenu.style.visibility = "hidden";
    msgMenu.style.display = "flex";
    msgMenu.style.left = "0px";
    msgMenu.style.top = "0px";

    const rect = msgMenu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = x;
    let top = y;

    if (left + rect.width + MENU_MARGIN > viewportWidth) {
        left = viewportWidth - rect.width - MENU_MARGIN;
    }
    if (left < MENU_MARGIN) {
        left = MENU_MARGIN;
    }

    if (top + rect.height + MENU_MARGIN > viewportHeight) {
        // Not enough room below the touch point — flip it above instead.
        top = y - rect.height;
    }
    if (top < MENU_MARGIN) {
        top = MENU_MARGIN;
    }
    if (top + rect.height + MENU_MARGIN > viewportHeight) {
        top = viewportHeight - rect.height - MENU_MARGIN;
    }

    msgMenu.style.left = left + "px";
    msgMenu.style.top = top + "px";
    msgMenu.style.visibility = "visible";
}

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
// REACTIONS (now inline at the top of msgMenu, no separate popup)
// =====================================

async function sendReaction(emoji) {
    if (!selectedMessage) return;

    await fetch("/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            message_id: selectedMessage.id,
            emoji: emoji
        })
    });

    closeMenu();
    loadMessages(true);
}

function openCustomEmojiPicker() {
    const input = document.getElementById("customEmojiInput");
    input.style.display = "block";
    input.value = "";
    input.focus();
}

document.getElementById("customEmojiInput").addEventListener("input", function () {
    // Typing/picking any character here (via the device's own emoji
    // keyboard) sends it immediately as the reaction.
    const emoji = this.value.trim();
    if (emoji) {
        sendReaction(emoji);
    }
});

// Prevent a tap inside the menu (e.g. on the custom emoji input)
// from bubbling up to the document click listener and closing the
// menu before the user's done with it.
msgMenu.addEventListener("click", function (e) {
    e.stopPropagation();
});

// =====================================
// PIN MESSAGES
// =====================================

async function togglePinSelected() {
    if (!selectedMessage) return;

    const newState = !selectedMessage.pinned;

    await fetch("/toggle_pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            message_id: selectedMessage.id,
            pin: newState
        })
    });

    closeMenu();
    loadMessages(true);
    fetchPinnedMessages();
}

async function fetchPinnedMessages() {
    try {
        const response = await fetch(
            `/pinned?chatwith=${encodeURIComponent(chatWith)}`,
            { cache: "no-store" }
        );

        const data = await response.json();
        pinnedMessagesList = data.pinned || [];

        const bar = document.getElementById("pinnedBar");
        const text = document.getElementById("pinnedText");

        if (pinnedMessagesList.length === 0) {
            bar.classList.remove("show");
            return;
        }

        const latest = pinnedMessagesList[pinnedMessagesList.length - 1];
        const countSuffix = pinnedMessagesList.length > 1
            ? ` (+${pinnedMessagesList.length - 1} more)`
            : "";

        text.textContent = latest.text + countSuffix;
        bar.classList.add("show");

    } catch (error) {
        console.log("Failed to load pinned messages:", error);
    }
}

function jumpToPinned() {
    if (pinnedMessagesList.length === 0) return;

    const target = pinnedMessagesList[currentPinnedIndex];
    jumpToMessage(target.id);

    currentPinnedIndex = (currentPinnedIndex + 1) % pinnedMessagesList.length;
}

// =====================================
// FORWARD
// =====================================

async function openForwardPicker() {
    closeMenu();

    const listEl = document.getElementById("forwardContactsList");
    listEl.innerHTML = "Loading...";

    document.getElementById("forwardPicker").classList.add("show");

    try {
        const response = await fetch("/contacts_list", { cache: "no-store" });
        const data = await response.json();

        if (!data.contacts || data.contacts.length === 0) {
            listEl.innerHTML = "<p style='color:var(--slate);'>No contacts to forward to.</p>";
            return;
        }

        listEl.innerHTML = "";

        data.contacts.forEach(contact => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = contact;
            btn.onclick = function () {
                forwardToContact(contact);
            };
            listEl.appendChild(btn);
        });

    } catch (error) {
        listEl.innerHTML = "<p style='color:var(--coral);'>Failed to load contacts.</p>";
    }
}

function closeForwardPicker() {
    document.getElementById("forwardPicker").classList.remove("show");
}

async function forwardToContact(contact) {
    if (!selectedMessage) return;

    const formData = new FormData();
    formData.append("username", username);
    formData.append("chatwith", contact);
    formData.append("message", selectedMessage.text);

    await fetch("/send", {
        method: "POST",
        body: formData
    });

    closeForwardPicker();

    if (contact === chatWith) {
        loadMessages(true);
    }
}

document.getElementById("forwardPicker").addEventListener("click", function (e) {
    if (e.target === this) closeForwardPicker();
});

// =====================================
// SELECTION MODE (copy / delete multiple)
// =====================================

function startSelectionMode() {
    closeMenu();
    selectionMode = true;
    selectedMessages.clear();

    // Selection mode replaces search — close it if it was open.
    closeSearch();

    document.getElementById("selectionHeader").classList.add("show");
    updateSelectionCount();

    if (selectedMessage) {
        const bubble = document.querySelector(`.bubble[data-id="${selectedMessage.id}"]`);
        if (bubble) toggleSelection(bubble, selectedMessage);
    }

    // Re-render so every bubble picks up the selection click handler
    renderMessages(latestMessages);
}

function toggleSelection(bubble, msg) {
    if (!selectionMode) return;

    if (selectedMessages.has(msg.id)) {
        selectedMessages.delete(msg.id);
        bubble.classList.remove("selected");
    } else {
        selectedMessages.set(msg.id, msg.text);
        bubble.classList.add("selected");
    }

    updateSelectionCount();
}

function updateSelectionCount() {
    document.getElementById("selectionCount").textContent =
        `${selectedMessages.size} selected`;
}

function cancelSelection() {
    selectionMode = false;
    selectedMessages.clear();
    document.getElementById("selectionHeader").classList.remove("show");
    document.querySelectorAll(".bubble.selected").forEach(b => b.classList.remove("selected"));
    renderMessages(latestMessages);
}

function copySelectedMessages() {
    if (selectedMessages.size === 0) return;

    // Preserve chat order, not selection order
    const orderedText = latestMessages
        .filter(msg => selectedMessages.has(msg.id))
        .map(msg => msg.text)
        .join("\n");

    if (navigator.clipboard) {
        navigator.clipboard.writeText(orderedText);
    } else {
        const temp = document.createElement("textarea");
        temp.value = orderedText;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
    }

    cancelSelection();
}

async function deleteSelectedMessages() {
    if (selectedMessages.size === 0) return;

    const count = selectedMessages.size;

    if (!confirm(`Delete ${count} message${count > 1 ? "s" : ""} for you?`)) {
        return;
    }

    const ids = Array.from(selectedMessages.keys());

    // Deletes for you specifically (same as "Delete For Me" on a
    // single message) — safe default for a bulk action that might
    // include messages you didn't send.
    await Promise.all(ids.map(id =>
        fetch("/delete_message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: username,
                message_id: id,
                mode: "me"
            })
        })
    ));

    cancelSelection();
    loadMessages(true);
}

// =====================================
// SEARCH IN CHAT
// =====================================

function toggleSearch() {
    if (selectionMode) return;

    const bar = document.getElementById("searchBar");
    const isShowing = bar.classList.toggle("show");

    if (isShowing) {
        document.getElementById("searchInput").focus();
    } else {
        closeSearch();
    }
}

function closeSearch() {
    document.getElementById("searchBar").classList.remove("show");
    document.getElementById("searchInput").value = "";

    document.querySelectorAll(".bubble").forEach(b => {
        b.classList.remove("search-hidden", "search-match");
    });
}

function performSearch() {
    const query = document.getElementById("searchInput").value.trim().toLowerCase();
    const bubbles = document.querySelectorAll(".bubble");

    if (query === "") {
        bubbles.forEach(b => b.classList.remove("search-hidden", "search-match"));
        return;
    }

    let firstMatch = null;

    bubbles.forEach(bubble => {
        const textEl = bubble.querySelector(".message-text");
        const matches = textEl && textEl.textContent.toLowerCase().includes(query);

        bubble.classList.toggle("search-hidden", !matches);
        bubble.classList.toggle("search-match", matches);

        if (matches && !firstMatch) firstMatch = bubble;
    });

    if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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
    fetchPinnedMessages();
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
