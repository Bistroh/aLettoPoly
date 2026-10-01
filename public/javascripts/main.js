let currentGameId = null;
let currentPlayers = [];
let turnIndex = 0;

// 1. GESTIONE DEL SETUP
document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const player1 = {
        token: document.getElementById('p1-token').value,
        clothesLevel: parseInt(document.getElementById('p1-clothes').value),
        secretPenalty: document.getElementById('p1-penalty').value
    };

    const player2 = {
        token: document.getElementById('p2-token').value,
        clothesLevel: parseInt(document.getElementById('p2-clothes').value),
        secretPenalty: document.getElementById('p2-penalty').value
    };

    try {
        const response = await fetch('/users/start-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player1, player2 })
        });

        if (response.ok) {
            const data = await response.json();
            currentGameId = data.gameId;
            console.log('Partita ID:', currentGameId);

            // Soluzione al bug: Assicuriamoci che la chiamata /users ritorni dati validi
            const playersResponse = await fetch('/users');
            if (!playersResponse.ok) throw new Error("Impossibile recuperare i giocatori");
            const allPlayers = await playersResponse.json();

            currentPlayers = allPlayers.filter(p => p.game_id === currentGameId);
            console.log('Giocatori caricati:', currentPlayers);

            if (currentPlayers.length === 0) {
                alert("Errore di caricamento: i giocatori non sono stati trovati nel database.");
                return;
            }

            document.getElementById('setup-section').style.display = 'none';
            document.getElementById('game-section').style.display = 'block';

            await loadBoard();
            initializeTokens();
            updateTurnUI();
            updateDashboards();
        } else {
            alert('Errore durante la creazione della partita');
        }
    } catch (error) {
        console.error("Errore fatale nel setup:", error);
        alert("Controlla la console. C'è un errore nella comunicazione col server.");
    }
});

// 2. GENERAZIONE DEL TABELLONE
async function loadBoard() {
    const res = await fetch('/api/board');
    const boardSpaces = await res.json();
    const boardElement = document.getElementById('game-board');

    boardSpaces.forEach(space => {
        const div = document.createElement('div');
        div.classList.add('casella');
        div.id = `space-${space.position_index}`;

        let row, col, latoClass;

        if (space.position_index === 0) { col = 11; row = 11; }
        else if (space.position_index < 10) { col = 11 - space.position_index; row = 11; latoClass = 'lato-basso'; }
        else if (space.position_index === 10) { col = 1; row = 11; }
        else if (space.position_index < 20) { col = 1; row = 11 - (space.position_index - 10); latoClass = 'lato-sinistro'; }
        else if (space.position_index === 20) { col = 1; row = 1; }
        else if (space.position_index < 30) { col = 1 + (space.position_index - 20); row = 1; latoClass = 'lato-alto'; }
        else if (space.position_index === 30) { col = 11; row = 1; }
        else { col = 11; row = 1 + (space.position_index - 30); latoClass = 'lato-destro'; }

        div.style.gridColumn = col;
        div.style.gridRow = row;
        if (latoClass) div.classList.add(latoClass);

        const colors = { 'Marrone': '#8B4513', 'Azzurro': '#87CEEB', 'Rosa': '#FF69B4', 'Arancione': '#FFA500', 'Rosso': '#FF0000', 'Giallo': '#FFFF00', 'Verde': '#008000', 'Blu': '#0000FF' };
        const colorHex = colors[space.color_group] || 'transparent';

        div.innerHTML = `
            <div style="background-color: ${colorHex}; width: 100%; height: 20px;"></div>
            <div style="padding: 2px;"><strong>${space.name}</strong></div>
            ${space.purchase_price > 0 ? `<div>${space.purchase_price}€</div>` : ''}
            <div class="tokens-container" id="tokens-${space.position_index}" style="display:flex; justify-content:center; gap:5px; margin-top:5px; flex-wrap:wrap;"></div>
        `;

        boardElement.appendChild(div);
    });
}

// 3. LOGICA DELLE PEDINE E ZOOM
function initializeTokens() {
    currentPlayers.forEach((player, index) => {
        const tokenDiv = document.createElement('div');
        tokenDiv.id = `token-player-${player.id}`;
        tokenDiv.style.width = '15px';
        tokenDiv.style.height = '15px';
        tokenDiv.style.borderRadius = '50%';
        tokenDiv.style.backgroundColor = index === 0 ? 'red' : 'blue';
        tokenDiv.style.border = '1px solid black';
        tokenDiv.title = player.token;

        document.getElementById('tokens-0').appendChild(tokenDiv);
    });
    document.getElementById('btn-roll').style.display = 'block';
}

function zoomOnSpace(positionIndex) {
    const board = document.getElementById('game-board');
    const space = document.getElementById(`space-${positionIndex}`);

    if (!space) return;

    // Calcola il centro della casella di destinazione rispetto al tabellone
    const boardRect = board.getBoundingClientRect();
    const spaceRect = space.getBoundingClientRect();

    const originX = ((spaceRect.left - boardRect.left + spaceRect.width / 2) / boardRect.width) * 100;
    const originY = ((spaceRect.top - boardRect.top + spaceRect.height / 2) / boardRect.height) * 100;

    // Applica lo zoom spostando l'origine sulla casella esatta
    board.style.transformOrigin = `${originX}% ${originY}%`;
    board.style.transform = "scale(1.8)"; // Effetto Zoom

    // Ripristina la visuale globale dopo 2.5 secondi
    setTimeout(() => {
        board.style.transform = "scale(1)";
    }, 2500);
}

function moveTokenVisual(playerId, newPosition) {
    const token = document.getElementById(`token-player-${playerId}`);
    const destination = document.getElementById(`tokens-${newPosition}`);
    destination.appendChild(token);

    // Innesca l'effetto zoom sulla nuova posizione
    zoomOnSpace(newPosition);
}

function updateTurnUI() {
    const activePlayer = currentPlayers[turnIndex];
    const btn = document.getElementById('btn-roll');
    btn.innerText = `Tira i Dadi (${activePlayer.token})`;
}

// Funzione per aggiornare graficamente le statistiche dei giocatori
function updateDashboards(playersData) {
    if (playersData) {
        currentPlayers = playersData; // Aggiorna i dati locali se passati dal backend
    }

    currentPlayers.forEach((player, index) => {
        const idSuffix = index === 0 ? 'p1' : 'p2';

        // Aggiorna Nome, Saldo e Vestiti
        document.getElementById(`name-${idSuffix}`).innerText = player.token;
        document.getElementById(`bal-${idSuffix}`).innerText = `${player.balance}€`;
        document.getElementById(`cloth-${idSuffix}`).innerText = player.clothes_level || player.clothesLevel;

        // Mostra/Nascondi lo stato prigione
        document.getElementById(`jail-${idSuffix}`).style.display = player.is_in_jail ? 'block' : 'none';

        // Evidenzia visivamente a chi tocca
        const dashElement = document.getElementById(`dash-${idSuffix}`);
        if (turnIndex === index) {
            dashElement.classList.add('active-turn');
        } else {
            dashElement.classList.remove('active-turn');
        }
    });
}

// 4. LANCIO DEI DADI
document.getElementById('btn-roll').addEventListener('click', async () => {
    if (currentPlayers.length === 0) {
        alert("Errore: nessun giocatore attivo.");
        return;
    }

    const activePlayer = currentPlayers[turnIndex];
    const btn = document.getElementById('btn-roll');
    btn.disabled = true; // Previene doppi click accidentali

    try {
        const response = await fetch('/api/roll-dice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: currentGameId, playerId: activePlayer.id })
        });

        const data = await response.json();

        if (response.ok) {
            moveTokenVisual(activePlayer.id, data.newPosition);

            // Ritarda l'alert per permettere allo zoom di mettersi a fuoco
            setTimeout(async () => {
                let alertMsg = `Dadi: ${data.dice[0]} e ${data.dice[1]} (Tot: ${data.total}).\n${data.message}\nSei su: ${data.landedSpace.name}`;

                // Aggiunta messaggi di Affitto
                if (data.propertyStatus === 'owned_by_partner') {
                    alertMsg += `\n\nQuesta casella è del tuo partner! Hai pagato ${data.rentPaid}€ di affitto.`;
                } else if (data.propertyStatus === 'owned_by_self') {
                    alertMsg += `\n\nSei a casa tua.`;
                }

                alert(alertMsg);

                if (data.bankrupt) {
                    alert(`Partita finita! ${activePlayer.token} ha perso. Esegui la penitenza!`);
                    btn.style.display = 'none';
                    return;
                }

                // Gestione Carte
                if (data.landedSpace.type === 'chance' || data.landedSpace.type === 'chest') {
                    await handleCardDraw(activePlayer.id, data.landedSpace.type);
                }
                // Gestione Acquisto Proprietà
                else if (data.propertyStatus === 'can_buy') {
                    const wantToBuy = confirm(`Vuoi acquistare "${data.landedSpace.name}" per ${data.landedSpace.purchase_price}€?`);

                    if (wantToBuy) {
                        try {
                            const buyRes = await fetch('/api/buy-property', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    gameId: currentGameId,
                                    playerId: activePlayer.id,
                                    spaceId: data.landedSpace.id
                                })
                            });

                            const buyData = await buyRes.json();
                            if (buyRes.ok) {
                                alert(`Hai acquistato ${buyData.spaceName}!\nNuovo saldo: ${buyData.newBalance}€`);
                                // Aggiunge visivamente un indicatore sulla casella
                                document.getElementById(`space-${data.landedSpace.position_index}`).style.border = `3px solid ${turnIndex === 0 ? 'red' : 'blue'}`;
                            } else {
                                alert(buyData.error);
                            }
                        } catch (e) {
                            console.error("Errore acquisto:", e);
                        }
                    }
                }

                if (!data.anotherTurn) {
                    turnIndex = turnIndex === 0 ? 1 : 0;
                    updateTurnUI();
                }

                btn.disabled = false;
            }, 800);

        } else {
            alert("Errore dal server: " + data.error);
            btn.disabled = false;
        }
    } catch (err) {
        console.error("Errore tiro dadi:", err);
        btn.disabled = false;
    }
});

// 5. PESCAGGIO CARTE
async function handleCardDraw(playerId, deckType) {
    try {
        const response = await fetch('/api/draw-card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: currentGameId, playerId, deckType })
        });

        const data = await response.json();

        if (response.ok) {
            alert(`CARTA PESCATA:\n${data.card.description}`);

            if (data.playerStats.newPosition !== undefined) {
                moveTokenVisual(playerId, data.playerStats.newPosition);
            }

            if (data.playerStats.bankrupt) {
                alert("Partita finita per bancarotta dopo la carta pescata!");
                document.getElementById('btn-roll').style.display = 'none';
            }
        }
    } catch (err) {
        console.error("Errore pescaggio carta:", err);
    }
}