const RANK_ORDER = [
    "Inhaber",
    "stv. Inhaber",
    "Projektleitung",
    "stv. Projektleitung",
    "Teamleitung",
    "stv. Teamleitung",
    "CCM",
    "stv. CCM",
    "Head Admin | 4Life",
    "Lead Admin | 4Life",
    "Senior Admin | 4Life",
    "Admin | 4Life",
    "Junior Admin | 4Life",
    "Head Moderator | 4Life",
    "Lead Moderator | 4Life",
    "Senior Moderator | 4Life",
    "Moderator | 4Life",
    "Head Support | 4Life",
    "Lead Support | 4Life",
    "Senior Support | 4Life",
    "Support | 4Life",
    "Trail Support | 4Life",
    "Team | 4Life"
];

let currentTeam = [];

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function loadTeam() {

    const response = await fetch("team?t=" + Date.now());

const data = await response.json();

if(!data || data.length === 0){
    console.log("Keine Teamdaten vorhanden, behalte alte Anzeige");
    return;
}

currentTeam = data;

const team = [...currentTeam];
team.sort((a, b) => {
    return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
});

    const container = document.querySelector("#teamCards");
    console.log("Team geladen:", team);
container.innerHTML = "";

    let admins = 0;
    let mods = 0;
    let supports = 0;

    team.forEach(member => {

        if (member.rank?.includes("Admin")) admins++;
if (member.rank?.includes("Moderator")) mods++;
if (member.rank?.includes("Support")) supports++;

const rankClass =
    member.rank?.includes("Admin") ? "admin" :
    member.rank?.includes("Moderator") ? "moderator" :
    member.rank?.includes("Support") ? "support" :
    member.rank?.includes("Inhaber") ? "inhaber" :
    member.rank?.includes("Projektleitung") ? "projektleitung" :
    member.rank?.includes("Teamleitung") ? "teamleitung" :
    member.rank?.includes("CCM") ? "ccm" :
    "default";

const departmentClass =
    member.department?.includes("Event") ? "event" :
    member.department?.includes("Entwickler") ? "entwickler" :
    member.department?.includes("Management") ? "management" :
    member.department?.includes("Cardev") ? "cardev" :
    member.department?.includes("Frakverwaltung") ? "frakverwaltung" :
    member.department?.includes("Leitung") ? "leitung" :
    "default";

      container.innerHTML += `

<div class="staff-card">

    <img src="${escapeHtml(member.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png')}" class="avatar">

    <div class="staff-info">

        <h3>${escapeHtml(member.name || member.username || "Unbekannt")}</h3>

        <small>@${escapeHtml(member.username || "")}</small>

        <p class="status ${escapeHtml(member.status || "offline")}">
    ● ${
        member.status === "online"
        ? "Online"
        : member.status === "idle"
        ? "Abwesend"
        : member.status === "dnd"
        ? "Nicht stören"
        : "Offline"
    }
</p>

        <span class="badge rank ${rankClass}">
    ${escapeHtml(member.rank || "Kein Rang")}
</span>

        <span class="badge department ${departmentClass}">
    ${escapeHtml(member.department || "Keine Abteilung")}
</span>

<span class="badge warns">
    ${member.warn && member.warn !== "Keine"
? "⚠️ " + escapeHtml(member.warn)
: "✅ Keine Warns"}
</span>

    </div>

</div>

`;
    });

    document.getElementById("teamCount").textContent = team.length;
    document.getElementById("adminCount").textContent = admins;
    document.getElementById("modCount").textContent = mods;
    document.getElementById("supportCount").textContent = supports;
}

document.getElementById("search").addEventListener("keyup", function () {

    const filter = this.value.toLowerCase();

    document.querySelectorAll(".staff-card").forEach(row => {

        row.style.display = row.innerText.toLowerCase().includes(filter)
            ? ""
            : "none";

    });

});

document.getElementById("departmentFilter").addEventListener("change", function () {

    const filter = this.value.toLowerCase();

    document.querySelectorAll(".staff-card").forEach(row => {

        if(filter === "all"){
            row.style.display = "";
            return;
        }

        row.style.display =
            row.innerText.toLowerCase().includes(filter)
            ? ""
            : "none";

    });

});

loadTeam();

// Alle 10 Sekunden aktualisieren
setInterval(loadTeam, 10000);