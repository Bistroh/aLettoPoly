const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Assicurati che il percorso punti al nuovo db.js con le Promise

// Ritorna la lista dei giocatori (utile per testare)
router.get('/', async function(req, res, next) {
  try {
    // Con mysql2/promise, query() restituisce un array dove il primo elemento contiene le righe
    const [results] = await db.query('SELECT * FROM players');
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore nel caricamento dei giocatori' });
  }
});

// API per creare una nuova partita e registrare 2 giocatori
router.post('/start-game', async function(req, res) {
  const { player1, player2 } = req.body;

  if (!player1 || !player2) {
    return res.status(400).json({ error: 'Dati dei giocatori mancanti.' });
  }

  let connection;

  try {
    // Richiediamo una connessione dedicata al pool per avviare la transazione
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Creiamo la partita nella tabella 'games'
    const [gameResult] = await connection.query("INSERT INTO games (status) VALUES ('in_progress')");
    const newGameId = gameResult.insertId;

    // 2. Prepariamo i dati dei due giocatori da inserire
    const playersQuery = `
      INSERT INTO players (game_id, token, clothes_level, secret_penalty) 
      VALUES 
      (?, ?, ?, ?),
      (?, ?, ?, ?)
    `;
    const playerValues = [
      newGameId, player1.token, player1.clothesLevel, player1.secretPenalty,
      newGameId, player2.token, player2.clothesLevel, player2.secretPenalty
    ];

    // 3. Inseriamo i giocatori
    const [playerResult] = await connection.query(playersQuery, playerValues);

    // In MySQL, un inserimento multiplo restituisce l'insertId del PRIMO record inserito
    const player1Id = playerResult.insertId;

    // 4. Aggiorniamo 'current_turn_player_id' in 'games' assegnandolo al Giocatore 1
    await connection.query(
        "UPDATE games SET current_turn_player_id = ? WHERE id = ?",
        [player1Id, newGameId]
    );

    // Confermiamo le operazioni sul database
    await connection.commit();
    connection.release();

    res.status(201).json({
      message: 'Partita creata con successo!',
      gameId: newGameId
    });

  } catch (error) {
    // In caso di errore, annulliamo tutte le operazioni (Rollback)
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("Errore durante la creazione della partita:", error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;