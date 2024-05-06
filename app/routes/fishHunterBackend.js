'use strict';
let quick = require('quick-pomelo');
let logger = quick.logger.getLogger('route', __filename);

let route = {};

route.handler = function (session, method, msg) {
    let serverId = session.get('fireServer');

    if (!serverId) {
        serverId = session.uid;
    } else {
        serverId = {sid: serverId};
    }

    logger.info('fishHunterBackend handler ', method, ' key ', serverId);

    return serverId;
};

route.remote = function (routeParam, method, args) {
    logger.info('fishHunterBackend remote ', method, ' key ', routeParam);

    return routeParam;
};

module.exports = route;
