let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');


let Remote = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Remote(app);
};

let proto = Remote.prototype;
let cort = P.coroutine;

proto.addLog = function (entryId, event, detail, cb) {
    try {
        let self = this;

        self.app.controllers.sysLogger.cache(entryId, event, detail);
        cb(null, {});

        // self.app.memdb.goose.transaction(P.coroutine(function*() {
        //   yield self.app.controllers.sysLogger.addLog(entryId, event, detail);
        //
        // }), self.app.getServerId())
        // .catch((err) => {
        //   self.app.event.emit('transactionFail');
        //   logger.info('loggerRemote sysLog reject ', err);
        // })
        // .nodeify(cb);
    } catch (err) {
        logger.error('[loggerRemote][addLog] entryId: %s, err: ', entryId, err);
    }
};
