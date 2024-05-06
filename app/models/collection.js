'use strict';

module.exports = function (app) {
    let mdbgoose = app.memdb.goose;

    let collectSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        playerId: {type: String, default: ''},
        gameId: {type: String, default: ''},
        bulletId: {type: Number, default: 1},
        count: {type: Number, default: 0},
        levels: {type: String, default: ''},
        cost: {type: Number, default: 0},
        shootType: {type: String, default: ''},
    }, {collection: 'collection_history'});

    collectSchema.statics.getId = function (playerId, gameId) {
        return playerId + gameId;
    };

    collectSchema.methods.toClientData = function () {
        return {
            playerId: this.playerId,
            gameId: this.gameId,
            bulletId: this.bulletId,
            count: this.count,
            levels: this.levels,
            cost: this.cost,
        };
    };

    mdbgoose.model('CollectionHistory', collectSchema);

};
