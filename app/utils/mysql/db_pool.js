var mysql = require('mysql');
var createMysqlPool = function (sqlConfig) {
    return mysql.createPool({
        connectionLimit: 3,
        host: sqlConfig.host,
        user: sqlConfig.user,
        password: sqlConfig.password,
        database: sqlConfig.database,
        port: sqlConfig.port || 3306
    });

};
exports.createMysqlPool = createMysqlPool;
