'use strict';
let quick = require('quick-pomelo');
let logger = quick.logger.getLogger('route', __filename);

let route = {};

route.handler = function (session, method, msg) {
    let key = session.uid;

    logger.info('fishHunter handler ', method, ' key ', key);

    return key;
};

route.remote = function (routeParam, method, args) {
    logger.info('fishHunter remote ', method, ' key ', routeParam);

    return routeParam;
};

module.exports = route;
