// Gemeinsames @-Erwähnungs-Modul für alle Chats (Aufgaben-Kommentare, Livechat).
// Erkennt "@" in einem Textfeld, zeigt eine Auswahl aktueller Teammitglieder und fügt
// die Auswahl wie bei Discord als "@Name" in den Text ein. Wird von task-detail.js und
// livechat.js eingebunden.

function createMentionPicker({ textarea, dropdown, getUsers }) {
    if (!textarea || !dropdown) return null;

    let activeMentions = [];
    let queryStart = -1;
    let highlightedIndex = 0;
    let currentMatches = [];

    function mentionEscapeHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function closeDropdown() {
        dropdown.classList.remove("open");
        dropdown.innerHTML = "";
        queryStart = -1;
        currentMatches = [];
    }

    function renderDropdown() {
        if (!currentMatches.length) {
            closeDropdown();
            return;
        }

        dropdown.innerHTML = currentMatches.map((user, index) => `
            <div class="mention-option${index === highlightedIndex ? " active" : ""}" data-index="${index}">
                <img class="mention-option-avatar" src="${mentionEscapeHtml(user.avatar || "https://cdn.discordapp.com/embed/avatars/0.png")}" alt="">
                <span>${mentionEscapeHtml(user.name)}</span>
            </div>
        `).join("");

        dropdown.classList.add("open");
    }

    function selectUser(user) {
        if (!user) return;

        const text = textarea.value;
        const caret = textarea.selectionStart;
        const before = text.slice(0, queryStart);
        const after = text.slice(caret);
        const insertion = `@${user.name} `;

        textarea.value = before + insertion + after;
        const newCaret = before.length + insertion.length;
        textarea.focus();
        textarea.setSelectionRange(newCaret, newCaret);

        if (!activeMentions.some(mention => mention.id === user.id)) {
            activeMentions.push({ id: user.id, name: user.name });
        }

        closeDropdown();
    }

    function updateQuery() {
        const caret = textarea.selectionStart;
        const text = textarea.value.slice(0, caret);
        const at = text.lastIndexOf("@");

        if (at === -1 || /[\s\n]/.test(text.slice(at + 1))) {
            closeDropdown();
            return;
        }

        // "@" muss am Textanfang stehen oder einem Leerzeichen/Zeilenumbruch folgen, damit
        // z.B. eine E-Mail-Adresse im Text nicht versehentlich das Dropdown öffnet.
        const charBeforeAt = at > 0 ? text[at - 1] : "";
        if (charBeforeAt && !/\s/.test(charBeforeAt)) {
            closeDropdown();
            return;
        }

        const query = text.slice(at + 1).toLowerCase();
        const users = getUsers() || [];

        currentMatches = users
            .filter(user => String(user.name || "").toLowerCase().includes(query))
            .slice(0, 8);

        queryStart = at;
        highlightedIndex = 0;
        renderDropdown();
    }

    textarea.addEventListener("input", updateQuery);
    textarea.addEventListener("click", updateQuery);

    // Auf dem document (Capture-Phase) statt direkt auf dem Textfeld registriert: so läuft
    // dieser Handler garantiert VOR dem Enter-zum-Senden-Handler der jeweiligen Seite
    // (z.B. livechat.js), unabhängig davon, in welcher Reihenfolge die Skripte geladen
    // wurden. stopPropagation verhindert dann zuverlässig, dass die Nachricht beim
    // Auswählen eines Vorschlags per Enter zusätzlich abgeschickt wird.
    document.addEventListener("keydown", event => {
        if (event.target !== textarea || !currentMatches.length) return;

        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            highlightedIndex = (highlightedIndex + 1) % currentMatches.length;
            renderDropdown();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            highlightedIndex = (highlightedIndex - 1 + currentMatches.length) % currentMatches.length;
            renderDropdown();
        } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            selectUser(currentMatches[highlightedIndex]);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeDropdown();
        }
    }, true);

    dropdown.addEventListener("mousedown", event => {
        const option = event.target.closest(".mention-option");
        if (!option) return;
        event.preventDefault();
        selectUser(currentMatches[Number(option.dataset.index)]);
    });

    document.addEventListener("click", event => {
        if (event.target !== textarea && !dropdown.contains(event.target)) {
            closeDropdown();
        }
    });

    return {
        getMentionsForSend() {
            const text = textarea.value;
            return activeMentions.filter(mention => text.includes(`@${mention.name}`));
        },
        reset() {
            activeMentions = [];
            closeDropdown();
        }
    };
}

// Baut aus bereits escapetem HTML-Text die @-Erwähnungen als hervorgehobene Spans.
// mentions ist die vom Server gespeicherte, validierte Liste ({id, name}) - der Text
// selbst wurde VOR dem Aufruf schon escaped, hier wird nur noch nach "@Name" gesucht.
function renderTextWithMentions(escapedText, mentions) {
    if (!escapedText || !Array.isArray(mentions) || !mentions.length) return escapedText;

    let result = escapedText;

    for (const mention of mentions) {
        const name = String((mention && mention.name) || "").trim();
        if (!name) continue;

        const escapedName = name
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

        result = result.split(`@${escapedName}`).join(`<span class="mention-tag">@${escapedName}</span>`);
    }

    return result;
}
