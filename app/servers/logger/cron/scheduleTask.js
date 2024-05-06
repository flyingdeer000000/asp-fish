let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');


let Cron = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Cron(app);
};

let proto = Cron.prototype;
let cort = P.coroutine;

proto.timerLoop = cort(function* () {
    this.app.controllers.sysLogger.persistent(100);
});
