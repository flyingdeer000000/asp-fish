var sqlclient = module.exports;
var db_pool = require('./db_pool');
var pool = null;
var poolModule = {};

poolModule.init = function (app) {
    pool = require('./db_pool').createMysqlPool(app);
};

poolModule.query = function (sql, args, cb) {

    var resourcePromise = pool.acquire();

    ////console.log("---------resourcePromise-------------"+JSON.stringify(args));
    ////console.log("---------resourcePromise-------------"+JSON.stringify(sql));

    resourcePromise
        .then(function (client) {
            client.query(sql, args, function (err, res) {
                pool.release(client);
                //console.log("--------pool------------------" + res);
                cb(err, res);
            });
        })
        .catch(function (err) {
            //console.log("---------error catch---------:" + err);
            //console.error('[sqlqueryErr] ' + err);
            return;
        });

    /*
        pool.acquire(
            function( err, client ){
    
                if( !!err ){
                    console.error('[sqlqueryErr] '+err.stack);
                    return;
                }
                client.query( sql, args, function( err, res ){
                    pool.release(client);
                    cb( err, res );
                } );
            }
        );
        */
};

poolModule.shutdown = function () {
    pool.destroyAllNow();
};


sqlclient.init = function (sqlConfig) {

    return db_pool.createMysqlPool(sqlConfig);
    /*
    if( !!pool ){
        return sqlclient;
    }else{
        poolModule.init( app );
        sqlclient.insert = poolModule.query;
        sqlclient.update = poolModule.query;
        sqlclient.delete = poolModule.query;
        sqlclient.query = poolModule.query;
        return sqlclient;
    }
    */
};

sqlclient.shutdown = function () {
    poolModule.shutdown(app);
};
