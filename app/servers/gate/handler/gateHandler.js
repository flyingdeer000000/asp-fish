'use strict';

let _ = require('lodash');
let C = require('../../../../share/constant');
const {Ret} = require("../../../utils/format-util");

let Handler = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Handler(app);
};

let proto = Handler.prototype;


proto.queryEntry = function (msg, session, next) {
    return this.getConnector(msg, session, next);
};

proto.getConnector = function (msg, session, next) {
    try {
        let servers = this.app.getServersByType('connector');
        let server = _.sample(servers);
        if (!server) {
            return next(null, {code: C.ERROR, msg: C.GATE_NO_CONNECTOR});
        }
        // let completed = this.app.controllers.gate.isCompleted();
        // if (!completed) {
        //     return next(null, { code: C.FAILD, msg: C.GATE_NO_CONNECTOR });
        // }
        let data = {
            host: server.clientHost,
            port: server.clientPortOut || server.clientPort,
            protocol: server.clientProtocol || "wss",
        };
        console.log("getConnector()", data);
        return Ret.data(next, data);
    } catch (ex) {
        Ret.error(next, "getConnector", ex);
    }


};

proto.getWebConnector = function (msg, session, next) {
    let servers = this.app.getServersByType('webconnector');
    let server = _.sample(servers);
    if (!server) {
        return next(null, {code: C.ERROR, msg: C.GATE_NO_CONNECTOR});
    }
    let completed = this.app.controllers.gate.isCompleted();
    if (!completed) {
        return next(null, {code: C.FAILD, msg: C.GATE_NO_CONNECTOR});
    }
    let data = {
        code: C.OK, data: {
            host: server.clientHost,
            port: server.clientPortOut || server.clientPort,
            protocol: server.clientProtocol || "wss",
        }
    };


    return next(null, data);
};

