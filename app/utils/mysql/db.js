var pomelo = require('pomelo');
var m_async = require('async');
var sprintf = require('sprintf-js').sprintf;
var logger = require('quick-pomelo').logger.getLogger('area', __filename);
var db = module.exports;

db.code = {
    OK: 200,
    FAIL: 500,
    DISCONNECT: 501,
    TIMEOUT: 502,
    DB: {
        GET_CONNECT_FAIL: 4001,
        QUERY_FAIL: 4002,
        DATA_EMPTY: 4003,
        CREATE_FAIL: 4004,
        UPDATE_FAIL: 4005,
        LOAD_DATA_FAIL: 4006,
        DATA_DUPLICATE: 4007,
        PARA_FAIL: 4008
    }
};
db.act_query = function (db_name, sql, args, cb) {
    pomelo.app.get(db_name).getConnection(function (err, connection) {
        if (err) {
            cb({code: db.code.DB.GET_CONNECT_FAIL, msg: err}, null);
            return;
        }
        connection.query(sql, args, function (err, res) {
            connection.release();
            if (err) {
                cb({code: db.code.DB.QUERY_FAIL, msg: err}, null);
            } else {
                //console.log('-sel_query res-', res);
                cb({code: db.code.OK}, res);
            }
        });
    });
}

db.act_transaction = function (db_name, sql_query, cb) {
    pomelo.app.get(db_name).getConnection(function (err, connection) {
        if (err) {
            cb(null, {code: db.code.DB.GET_CONNECT_FAIL, msg: err});
            return;
        }
        //-----------------transaction start---------------        
        connection.beginTransaction(function (err) {
            var funcAry = [];
            sql_query.forEach(function (sql, index) {
                var temp = function (cb) {
                    connection.query(sql, [], function (temp_err, results) {
                        if (temp_err) {
                            connection.rollback(function () {
                                return cb(db.code.DB.QUERY_FAIL);
                            });
                        } else {
                            return cb(db.code.OK, results);
                        }
                    })
                };
                funcAry.push(temp);
            });

            m_async.series(funcAry, function (err, result) {
                if (err) {
                    connection.rollback(function (err) {
                        connection.release();
                        return cb({code: db.code.DB.QUERY_FAIL, msg: ''}, null);
                    });
                } else {
                    connection.commit(function (err, info) {
                        if (err) {
                            connection.rollback(function (err) {
                                connection.release();
                                return cb({code: db.code.DB.QUERY_FAIL, msg: err}, null);
                            });
                        } else {
                            connection.release();
                            return cb({code: db.code.OK}, result);
                        }
                    })
                }
            });
        });
        //-----------------transaction end--------------- 
    });
}

/*
取筆數
*/
db.act_info_rows = function (db_name, sql, cb) {
    var self = this;
    var sql2 = "SELECT FOUND_ROWS() AS ROWS;";
    var sql_query = [];
    sql_query.push(sql);
    sql_query.push(sql2);

    self.act_transaction(db_name, sql_query, function (r_code, r_data) {
        if (r_code.code !== db.code.OK) {
            cb(r_code, null);
        } else {
            var data = {
                count: r_data[1][0]['ROWS'],
                info: r_data[0]
            }
            cb(r_code, data);
        }
    });
}

/*
判斷有無此欄位名
*/
db.act_getCOLUMNS = function (db_name, table, cb) {
    var sql = sprintf("SHOW COLUMNS FROM %s", table);
    var self = this;
    self.act_query(db_name, sql, [], function (r_code, r_data) {
        if (r_code.code !== db.code.OK) {
            cb(r_code, null);
        } else {
            var fieldAry = r_data.map(item => item.Field);
            cb({
                code: db.code.OK
            }, fieldAry);
        }
    });
}

/*
新增 
db_name: DB名稱
table:資料表
saveData: 要新增的資料
*/
db.act_insert_data = function (db_name, table, saveData, cb) {
    var self = this;
    self.act_getCOLUMNS(db_name, table, function (r_code, fieldAry) {
        if (r_code.code !== db.code.OK) {
            cb(r_code, null);
        } else {
            var insert_sql = [];
            Object.keys(saveData).forEach(item => {
                if (fieldAry.indexOf(item) > -1) {
                    var add_sql = sprintf(" `%s` = '%s' ", item, saveData[item]);
                    insert_sql.push(add_sql);
                }
            });
            var sql = sprintf("INSERT INTO %s SET %s", table, insert_sql.join(","));
            //console.log('act_insert_data-sql', sql);
            self.act_query(db_name, sql, [], function (r_code, r_data) {
                //console.log('insert res',JSON.stringify(r_code),JSON.stringify(r_data));
                if (r_code.code !== db.code.OK) {
                    cb(r_code, null);
                } else {
                    cb(r_code, r_data.insertId);
                }
            });
        }
    });
}

/*
更新
db_name: DB名稱
table:資料表
saveData: 要修改的資料
*/

db.act_update_data = function (db_link, table, saveData, sql_where, cb) {
    var self = this;
    self.act_getCOLUMNS(db_link, table, function (r_code, fieldAry) {
        if (r_code.code !== db.code.OK) {
            cb(r_code, null);
        } else {
            var update_sql = [];
            Object.keys(saveData).forEach(item => {
                if (fieldAry.indexOf(item) > -1) {
                    var add_sql = sprintf(" `%s` = '%s' ", item, saveData[item]);
                    update_sql.push(add_sql);
                }
            });
            var sql = sprintf("UPDATE %s SET %s WHERE %s", table, update_sql.join(","), sql_where);
            //console.log('act_update_data-sql', sql);
            self.act_query(db_link, sql, [], function (r_code, r_data) {
                //console.log('update res',JSON.stringify(r_code),JSON.stringify(r_data));
                cb(r_code, r_data);
            });
        }
    });
}
