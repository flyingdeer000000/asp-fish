'use strict';

module.exports = function (app) {
    let mdbgoose = app.memdb.goose;

    let tableSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        name: {type: String, default: ''},
        hostId: {type: String, default: ''},
        serverId: {type: String, default: ''},
        gameId: {type: String, default: ''},
        secret: {type: String, default: ''},
        recycle: {type: Boolean, default: true},
        chairIds: {type: [String], default: []},
        maxChairs: {type: Number, default: 2},
        level: {type: Number, default: 0},
        currency: {type: String, default: 'CNY'},
        createBy: {type: String, default: ''},
        createTime: {type: String, default: ''},
    }, {collection: 'tables'});

    tableSchema.virtual('playerIds').get(function () {
        return this.chairIds.filter((p) => !!p && p !== '');
    });

    tableSchema.methods.addPlayer = function (id) {

        if (this.chairIds.includes(id)) {
            return -1;
        }

        for (let i = 0; i < this.chairIds.length; i++) {
            if (!this.chairIds[i] || this.chairIds[i] == '') {
                this.chairIds[i] = id;
                this.markModified('chairIds');
                return 1;
            }
        }

        if (this.chairIds.length >= this.maxChairs) {
            // throw new Error('table ' + this._id + ' is full');
            return 0;
        } else {
            this.chairIds.push(id);
            this.markModified('chairIds');
            return 1;
        }
    };
    tableSchema.methods.removePlayer = function (id) {
        for (let i = 0; i < this.chairIds.length; i++) {
            if (this.chairIds[i] == id) {
                this.chairIds[i] = '';
                this.markModified('chairIds');
                break;
            }
        }
    };

    tableSchema.methods.chooseHost = function (idx) {
        for (let i = 0; i < this.playerIds.length; i++) {
            let j = idx + i + 1;
            j = j >= this.playerIds.length ? j - this.playerIds.length : j;
            if (this.playerIds[j] !== null) {
                return this.playerIds[j];
            }
        }
        return null;
    };

    tableSchema.statics.getInternalUpdatableKeys = function () {
        return ['recycle'];
    };

    tableSchema.methods.playerCount = function () {
        return this.playerIds.filter((p) => !!p && p != '').length;
    };
    tableSchema.methods.pushPlayers = function (self) {
        return this.playerIds.filter((p) => !!p && p != self);
    };

    tableSchema.methods.toClientData = function () {
        return {
            _id: this._id,
            name: this.name,
            hostId: this.hostId,
            serverId: this.serverId,
            recycle: this.recycle,
            playerIds: this.playerIds,
            chairIds: this.chairIds,
            level: this.level,
            gameId: this.gameId,
            currency: this.currency,
        };
    };

    mdbgoose.model('Table', tableSchema);
};
