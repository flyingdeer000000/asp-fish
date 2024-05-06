let quick = require('quick-pomelo');
let P = quick.Promise;
const uuid = require('uuid/v1');
let util = require('util')
let logger = quick.logger.getLogger('connector', __filename);
let pvaLogger = quick.logger.getLogger('pva', __filename);

let Controller = function (app) {
    this.app = app;

    this.logCache = [];
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

proto.cache = function (entryId, event, detail) {
    try {
        this.logCache.push({
            entryId: entryId,
            event: event,
            detail: detail
        })
    } catch (err) {
        logger.error('[sysLogger][cache] entryId: %s, err: ', entryId, err);
    }
}

proto.persistent = function (count) {
    if (this.logCache.length == 0) {
        return;
    }

    let self = this;
    let logs = [];
    return this.app.memdb.goose.transactionAsync(cort(function* () {

        while (count > 0) {
            let val = self.logCache.shift();
            if (!val) {
                break;
            }

            logs.push(val);
            --count;
        }

        if (logs.length > 0) {
            for (let i in logs) {
                yield self.addLog(logs[i].entryId, logs[i].event, logs[i].detail);
            }
        }
    }), this.app.getServerId())
        .catch(err => {
            logger.error('logger persistent error ', err, ' logs ', logs);
        })
}

proto.addLog = cort(function* (entryId, event, detail) {
    try {
        if (this.app.getServerType() == 'logger') {
            let rec = new this.app.models.SystemLog({
                _id: uuid(),
                entryId: entryId,
                event: event,
                time: Date.now(),
                detail: detail
            });

            yield rec.saveAsync();
        } else {
            // logger.info('sysLog serverId ',this.app.getServerId(),entryId,',',event,',',detail);

            let rpc = this.app.rpc.logger.loggerRemote;
            rpc.addLog(this.app.getServerId(), entryId, event, detail, function (err, res) {

            });
        }
    } catch (err) {
        logger.error('[sysLogger][addLog] entryId: %s, err: ', entryId, err);
    }
});

proto.getEvent = function (model, action) {
    try {
        let n = model.schema.options.collection;

        switch (action) {
            case 'c':
                n += ' insert';
                break;
            case 'u':
                n += ' update';
                break;
            case 'd':
                n += ' delete';
                break;
            default:
                n += ' default';
                break;
        }

        return n;
    } catch (err) {
        logger.error('[sysLogger][getEvent] action: %s, err: ', action, err);
    }
}

proto.PVA_ACTION = {
    N_ACCOUNT: 'new.account',
    U_ACCOUNT: 'update.account',
    N_TOKENS: 'new.tokens',
    U_TOKENS: 'update.tokens'
}

proto.pvaLog = function (key, action, data) {
    try {
        if (!data) {
            data = {};
        }
        data.logTime = Date.now();
        pvaLogger.info(key + '_' + action, '[', util.inspect(data), ']');
    } catch (err) {
        logger.error('[sysLogger][pvaLog] err: ', err);
    }
}
