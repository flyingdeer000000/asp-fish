const MemDB = require('memdb-client');
const Goose = MemDB.goose;

const Mona = function (opts) {
    opts = opts || {};
    this.schema = opts.schema;
    this.shards = opts.shards || [];
    this.shardId = opts.shardId || '';
}

Mona.prototype.setShards = function (shards) {
    this.shards = shards;
}

Mona.prototype.setShardId = function (shardId) {
    this.shardId = shardId;
}

Mona.prototype.setSchema = function (schema) {
    this.schema = schema;
}

Mona.prototype.branch = function ({schema, shardId}) {
    return new Mona({
        schema: schema || this.schema,
        shardId: shardId || this.shardId,
        shards: this.shards,
    });
}


Mona.prototype.connect = async function (args) {
    return Goose.connect(args);
}

Mona.prototype.transaction = async function (func, shardId) {
    return Goose.transaction(func, shardId || this.shardId);
}

Mona.prototype.action = async function ({
                                            cmd, schema, id, data, query, shardId
                                        }) {
    schema = schema || this.schema;
    shardId = shardId || this.shardId;
    return this.transaction(async function () {
        let target;
        switch (cmd) {
            case 'create':
            case 'insert':
                if (!data._id) {
                    data._id = id;
                }
                return await schema(data).save();
            case 'upsert':
                target = await schema.findById(id);
                if (target) {
                    return target;
                }
                if (!data._id) {
                    data._id = id;
                }
                return await schema(data).save();
            case 'update':
                target = await schema.findById(id);
                for (let k in data) {
                    target[k] = data[k];
                }
                return await target.save();
            case 'get':
                return schema.findById(id);
            case 'getReadOnly':
                return schema.findByIdReadOnly(id);
            case 'find':
                return schema.find(query);
            case 'findOne':
                return schema.findOne(query);
            case 'delete':
            case 'remove':
                return schema.remove(query);
            default:
                throw new Error(`unsupported command ${cmd}`);
        }

    }, shardId);
}


Mona.prototype.find = async function ({schema, query}) {
    return this.action({
        cmd: 'find', schema, query,
    });
};

Mona.prototype.findOne = async function ({schema, query}) {
    return this.action({
        cmd: 'findOne', schema, query,
    });
};

Mona.prototype.insert = async function ({schema, id, data, shardId}) {
    return this.action({
        cmd: 'insert', shardId, schema, id, data
    });
};

Mona.prototype.upsert = async function ({schema, id, data, shardId}) {
    return this.action({
        cmd: 'upsert', shardId, schema, id, data
    });
};

Mona.prototype.update = async function ({schema, id, data, shardId}) {
    return this.action({
        cmd: 'update', shardId, schema, id, data
    });
}

Mona.prototype.get = async function ({schema, id, shardId}) {
    return this.action({
        cmd: 'get', shardId, schema, id,
    });
}

Mona.prototype.getReadOnly = async function ({schema, id, shardId}) {
    return this.action({
        cmd: 'getReadOnly', shardId, schema, id
    });
}


Mona.prototype.remove = async function ({schema, query, shardId}) {
    return this.action({
        cmd: 'remove', shardId, schema, query
    });
}

module.exports = Mona;