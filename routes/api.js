const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Percorso corretto aggiornato

// GET /board - Risponderà alla chiamata /api/board fatta dal frontend
router.get('/board', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM board_spaces ORDER BY position_index ASC');
        res.json(rows);
    } catch (err) {
        console.error("Errore nel recupero del tabellone:", err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// POST /api/buy-property - Gestisce l'acquisto di una casella
router.post('/buy-property', async (req, res) => {
    const { gameId, playerId, spaceId } = req.body;

    if (!gameId || !playerId || !spaceId) {
        return res.status(400).json({ error: 'Dati mancanti per l\'acquisto' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Recupera dati giocatore e proprietà
        const [players] = await connection.query('SELECT balance FROM players WHERE id = ?', [playerId]);
        const [spaces] = await connection.query('SELECT purchase_price, name FROM board_spaces WHERE id = ?', [spaceId]);

        const player = players[0];
        const space = spaces[0];

        if (player.balance < space.purchase_price) {
            connection.release();
            return res.status(400).json({ error: 'Fondi insufficienti per l\'acquisto' });
        }

        // Scala i soldi e assegna la proprietà
        const newBalance = player.balance - space.purchase_price;
        await connection.query('UPDATE players SET balance = ? WHERE id = ?', [newBalance, playerId]);

        await connection.query(
            'INSERT INTO player_properties (game_id, player_id, space_id, houses_count, is_mortgaged) VALUES (?, ?, ?, 0, false)',
            [gameId, playerId, spaceId]
        );

        await connection.commit();
        connection.release();

        res.json({ success: true, newBalance: newBalance, spaceName: space.name });
    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error("Errore durante l'acquisto:", err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});





// POST /api/roll-dice - Gestisce il lancio dei dadi, i doppi e la prigione
router.post('/roll-dice', async (req, res) => {
    const { gameId, playerId } = req.body;

    if (!gameId || !playerId) {
        return res.status(400).json({ error: 'Dati mancanti per il lancio dei dadi' });
    }

    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Controllo Turno
        const [game] = await connection.query('SELECT current_turn_player_id FROM games WHERE id = ?', [gameId]);
        if (game[0].current_turn_player_id !== parseInt(playerId)) {
            connection.release();
            return res.status(403).json({ error: 'Non è il tuo turno' });
        }

        // 2. Lancio dei dadi
        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const totalRoll = die1 + die2;
        const isDouble = die1 === die2;

        // 3. Recupero lo stato attuale del giocatore
        const [players] = await connection.query(
            'SELECT current_position, consecutive_doubles, is_in_jail, jail_turns, balance FROM players WHERE id = ?',
            [playerId]
        );
        const player = players[0];

        let newPosition = player.current_position;
        let newConsecutiveDoubles = player.consecutive_doubles;
        let goToJail = player.is_in_jail;
        let newJailTurns = player.jail_turns;
        let newBalance = player.balance;
        let endTurn = false;
        let message = "";

        // 4. Logica di Movimento e Prigione
        if (goToJail) {
            newJailTurns += 1;

            if (isDouble) {
                // Esce col doppio (non tira di nuovo)
                goToJail = false;
                newJailTurns = 0;
                newPosition = (player.current_position + totalRoll) % 40;
                endTurn = true;
                message = "Sei uscito di prigione con un doppio!";
            } else if (newJailTurns === 3) {
                // Terzo turno senza doppio: paga 200€ ed esce
                goToJail = false;
                newJailTurns = 0;
                newBalance -= 200;
                newPosition = (player.current_position + totalRoll) % 40;
                endTurn = true;
                message = "Non hai fatto doppio per 3 turni. Hai pagato 200€ di cauzione e sei uscito.";
            } else {
                // Resta in prigione
                endTurn = true;
                message = `Nessun doppio. Resti in prigione (Turno ${newJailTurns}/3).`;
            }
        } else {
            // Logica normale (giocatore libero)
            if (isDouble) {
                newConsecutiveDoubles += 1;
                if (newConsecutiveDoubles === 3) {
                    goToJail = true;
                    newPosition = 10; // Indice della casella Prigione
                    newConsecutiveDoubles = 0;
                    endTurn = true;
                    message = "Hai fatto 3 doppi di fila! Vai dritto in prigione.";
                } else {
                    newPosition = (player.current_position + totalRoll) % 40;
                    endTurn = false; // Ha diritto a un altro tiro
                    message = "Hai fatto doppio! Tira di nuovo.";
                }
            } else {
                newPosition = (player.current_position + totalRoll) % 40;
                newConsecutiveDoubles = 0;
                endTurn = true;
                message = `Hai tirato ${totalRoll}.`;
            }
        }

        // Verifica bancarotta (se ha pagato la cauzione ed è andato sotto zero)
        let isBankrupt = newBalance <= 0;

        // 5. Aggiornamento dei dati del giocatore
        await connection.query(
            'UPDATE players SET current_position = ?, consecutive_doubles = ?, is_in_jail = ?, jail_turns = ?, balance = ?, is_bankrupt = ? WHERE id = ?',
            [newPosition, newConsecutiveDoubles, goToJail, newJailTurns, newBalance, isBankrupt, playerId]
        );

        // 6. Cambio turno se necessario
        if (endTurn && !isBankrupt) {
            const [otherPlayers] = await connection.query(
                'SELECT id FROM players WHERE game_id = ? AND id != ? LIMIT 1',
                [gameId, playerId]
            );
            if (otherPlayers.length > 0) {
                await connection.query(
                    'UPDATE games SET current_turn_player_id = ? WHERE id = ?',
                    [otherPlayers[0].id, gameId]
                );
            }
        }

        // 7. Recupero i dettagli della casella di destinazione
        const [landedSpaces] = await connection.query(
            'SELECT * FROM board_spaces WHERE position_index = ?',
            [newPosition]
        );
        const space = landedSpaces[0];

        // 8. LOGICA DI BUSINESS: Affitti e Proprietà
        let propertyStatus = 'none';
        let rentPaid = 0;

        if (space.type === 'property') {
            // Controlla se qualcuno possiede questa proprietà
            const [ownership] = await connection.query(
                'SELECT * FROM player_properties WHERE space_id = ? AND game_id = ?',
                [space.id, gameId]
            );

            if (ownership.length > 0) {
                const ownerId = ownership[0].player_id;

                if (ownerId !== parseInt(playerId)) {
                    propertyStatus = 'owned_by_partner';

                    // Calcolo affitto base (espandibile in futuro con case/alberghi)
                    rentPaid = space.rent_base;
                    if (ownership[0].houses_count === 1) rentPaid = space.rent_1h;
                    else if (ownership[0].houses_count === 2) rentPaid = space.rent_2h;
                    else if (ownership[0].houses_count === 3) rentPaid = space.rent_hotel;

                    // Trasferimento soldi
                    newBalance -= rentPaid;
                    await connection.query('UPDATE players SET balance = balance + ? WHERE id = ?', [rentPaid, ownerId]);
                    await connection.query('UPDATE players SET balance = ? WHERE id = ?', [newBalance, playerId]);
                } else {
                    propertyStatus = 'owned_by_self';
                }
            } else {
                propertyStatus = 'can_buy';
            }
        }

        // Ricalcola la bancarotta dopo l'eventuale affitto
        isBankrupt = newBalance <= 0;
        if (isBankrupt) {
            await connection.query('UPDATE players SET is_bankrupt = true WHERE id = ?', [playerId]);
        }

        await connection.commit();
        connection.release();

        res.json({
            dice: [die1, die2],
            total: totalRoll,
            isDouble: isDouble,
            inJail: goToJail,
            anotherTurn: !endTurn,
            balance: newBalance,
            bankrupt: isBankrupt,
            previousPosition: player.current_position,
            newPosition: newPosition,
            landedSpace: space,
            message: message,
            propertyStatus: propertyStatus,
            rentPaid: rentPaid
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error("Errore durante il lancio dei dadi:", err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});


// POST /api/draw-card - Pesca una carta e ne applica l'effetto
router.post('/draw-card', async (req, res) => {
    const { gameId, playerId, deckType } = req.body;

    if (!gameId || !playerId || !deckType) {
        return res.status(400).json({ error: 'Dati mancanti per pescare la carta' });
    }

    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Pesca una carta casuale dal mazzo richiesto ('chance' o 'chest')
        const [cards] = await connection.query(
            'SELECT * FROM cards WHERE deck_type = ? ORDER BY RAND() LIMIT 1',
            [deckType]
        );

        if (cards.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Mazzo vuoto' });
        }

        const card = cards[0];
        const payload = card.action_payload;

        // 2. Recupera lo stato attuale del giocatore
        const [players] = await connection.query(
            'SELECT balance, clothes_level, current_position FROM players WHERE id = ?',
            [playerId]
        );
        const player = players[0];

        let newBalance = player.balance;
        let newClothes = player.clothes_level;
        let newPosition = player.current_position;
        let goToJail = false;
        let passGoBonus = false;

        // 3. Applica l'effetto della carta
        switch (card.action_category) {
            case 'money_bank':
                newBalance += payload.amount;
                break;

            case 'remove_clothes':
                newClothes -= payload.clothes_to_remove;
                if (payload.extra_penalty) {
                    newBalance += payload.extra_penalty;
                }
                break;

            case 'move_absolute':
                // Se la nuova posizione è minore di quella attuale e non stiamo andando in prigione, è passato dal VIA
                if (payload.position < newPosition && payload.position !== 10) {
                    passGoBonus = true;
                    newBalance += 200;
                }
                newPosition = payload.position;
                if (newPosition === 10) goToJail = true;
                break;

            case 'move_relative':
                newPosition = (newPosition + payload.spaces + 40) % 40;
                break;

            case 'add_clothes':
                // Aggiunge i vestiti indicati (99 nel caso di "tutti i vestiti", limitabile lato frontend o backend se si conosce il massimo)
                newClothes += payload.clothes_to_add;
                break;
            case 'action_text':
                // Nessuna modifica al database, il giocatore legge semplicemente l'azione sullo schermo
                break;

            case 'jail_free':
                // Da implementare in futuro salvando il possesso della carta
                break;
        }

        // Verifica sconfitta
        let isBankrupt = newBalance <= 0 || newClothes <= 0;

        // 4. Aggiorna il database
        await connection.query(
            'UPDATE players SET balance = ?, clothes_level = ?, current_position = ?, is_in_jail = ?, is_bankrupt = ? WHERE id = ?',
            [newBalance, newClothes, newPosition, goToJail, isBankrupt, playerId]
        );

        await connection.commit();
        connection.release();

        // 5. Rispondi al frontend con la carta pescata e le nuove statistiche
        res.json({
            card: {
                description: card.description,
                category: card.action_category
            },
            playerStats: {
                balance: newBalance,
                clothesLevel: newClothes,
                newPosition: newPosition,
                inJail: goToJail,
                bankrupt: isBankrupt,
                passGoBonus: passGoBonus
            }
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error("Errore durante la pesca della carta:", err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});


module.exports = router;