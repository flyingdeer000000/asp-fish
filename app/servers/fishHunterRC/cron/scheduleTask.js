let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');
let controller = require('../../../controllers/fishHunterRC');
let fishHunterRC;

let Cron = function (app) {
    this.app = app;
};

module.exports = function (app) {
    fishHunterRC = new controller(app);
    app.set('fishHunterRC', fishHunterRC);
    fishHunterRC.start();
    return new Cron(app);
};

let proto = Cron.prototype;
let cort = P.coroutine;

proto.timerLoop = cort(function* () {
    try {
        yield this.app.controllers.fishHunterRC.persistent();
    } catch (err) {
        logger.error('fishHunterRC.persistent ', err);
    }
});
