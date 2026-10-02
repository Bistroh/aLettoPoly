const mysql = require('mysql2/promise');

// Crea un Pool di connessioni invece di una connessione singola
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'alettopoly',
    waitForConnections: true,
    connectionLimit: 10,    // Numero massimo di connessioni simultanee
    queueLimit: 0
});

// Test iniziale per confermare che il database comunichi correttamente
pool.getConnection()
    .then(connection => {
        console.log('Connesso al database MySQL tramite Pool con successo!');
        connection.release(); // Importante: rimette la connessione nel pool
    })
    .catch(err => {
        console.error('Errore di connessione a MySQL:', err.message);
    });

// Esporta il pool per usarlo nei tuoi file di routing
module.exports = pool;