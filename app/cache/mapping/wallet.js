let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../../share/constant');
let utils = require('../../utils/utils');
let logger = quick.logger.getLogger('connector', __filename);
let consts = require('../../../share/consts');

module.exports = wallet = {};

wallet.batchSave = function (client, val, cb) {
    let app = client;

    P.resolve(0)
        .then(() => {
            // memdb tokens
            let dao = app.controllers.daoMgr.getGameTokenDao();
            const {
                playerId,
                gameId,
                amount,
                cost,
                gain,
                lastIndex,
                frozenCost,
                frozenGain,
                wagerId,
                quota,
                lastFireTime
            } = val

            return dao.saveMemWalletAsync(playerId, gameId, amount, gain, cost, lastIndex, frozenCost, frozenGain, wagerId, quota, lastFireTime)
        })
        .nodeify(cb);
}
