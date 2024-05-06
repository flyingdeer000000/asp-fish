/**
 MemDB Backend.
 Implementation of the storage backend using MemDB
 */
"use strict";

// let contract = require('./contract');
let async = require('async');
let _ = require('lodash');
let P = require('quick-pomelo').Promise

// Name of the collection where meta and allowsXXX are stored.
// If prefix is specified, it will be prepended to this name, like acl_resources
let aclCollectionName = 'resources';

function MemdbBackend(db, prefix, useSingle, useRawCollectionNames) {
    this.db = db;
    this.prefix = typeof prefix !== 'undefined' ? prefix : '';
    this.useSingle = (typeof useSingle !== 'undefined') ? useSingle : false;
    this.useRawCollectionNames = useRawCollectionNames === false; // requires explicit boolean false value
}

MemdbBackend.prototype = {
    /**
     Begins a transaction.
     */
    begin: function () {
        // returns a transaction object(just an array of functions will do here.)
        return [];
    },

    /**
     Ends a transaction (and executes it)
     */
    end: function (transaction, cb) {
        // contract(arguments).params('array', 'function').end();
        async.series(transaction, function (err) {
            cb(err instanceof Error ? err : undefined);
        });
    },

    /**
     Cleans the whole storage.
     */
    clean: function (cb) {
        console.warn('db clean ');
        cb(null);
        // contract(arguments).params('function').end();
        // this.db.collections(function(err, collections) {
        //   if (err instanceof Error) return cb(err);
        //   async.forEach(collections,function(coll,innercb){
        //     coll.drop(function(){innercb()}); // ignores errors
        //   },cb);
        // });
    },

    /**
     Gets the contents at the bucket's key.
     */
    get: function (bucket, key, cb) {
        // contract(arguments)
        //     .params('string', 'string|number', 'function')
        //     .end();
        key = encodeText(key);
        let searchParams = (this.useSingle ? {_bucketname: bucket, key: key} : {key: key});
        let collName = (this.useSingle ? aclCollectionName : bucket);

        this.db.collection(this.prefix + this.removeUnsupportedChar(collName), function (err, collection) {
            if (err instanceof Error) return cb(err);
            // Excluding bucket field from search result
            collection.findOne(searchParams, {_bucketname: 0}).nodeify(function (err, doc) {
                if (err) return cb(err);
                if (!_.isObject(doc)) return cb(undefined, []);
                doc = fixKeys(doc);
                cb(undefined, _.without(_.keys(doc), "key", "_id"));
            });
        });
    },

    /**
     Returns the union of the values in the given keys.
     */
    union: function (bucket, keys, cb) {
        // contract(arguments)
        //   .params('string', 'array', 'function')
        //   .end();
        keys = encodeAll(keys);
        let searchParams = [];

        if (!_.isArray(keys)) {
            let key = (this.useSingle ? {_bucketname: bucket, key: keys} : {key: keys});
            searchParams.push(key);
        } else {
            keys.forEach((value) => {
                let key = (this.useSingle ? {_bucketname: bucket, key: value} : {key: value});
                searchParams.push(key);
            })
        }


        let collName = (this.useSingle ? aclCollectionName : bucket);

        this.db.collection(this.prefix + this.removeUnsupportedChar(collName), function (err, collection) {
            if (err instanceof Error) return cb(err);
            // Excluding bucket field from search result

            let keyArrays = [];
            P.each(searchParams, (params) => {
                return collection.find(params, {_bucketname: 0}).then((docs) => {
                    docs = fixAllKeys(docs);
                    docs.forEach(function (doc) {
                        keyArrays.push.apply(keyArrays, _.keys(doc));
                    });
                })
            })
                .then(() => {
                    return keyArrays;
                })
                .nodeify(function (err, docs) {
                    if (err instanceof Error) return cb(err);
                    if (!docs.length) return cb(undefined, []);

                    cb(undefined, _.without(_.union(keyArrays), "key", "_id"));
                });
        });
    },

    /**
     Adds values to a given key inside a bucket.
     */
    add: function (transaction, bucket, key, values) {
        // contract(arguments)
        //     .params('array', 'string', 'string|number','string|array|number')
        //     .end();

        if (key == "key") throw new Error("Key name 'key' is not allowed.");
        key = encodeText(key);
        let self = this;
        let updateParams = (self.useSingle ? {_bucketname: bucket, key: key} : {key: key});
        let collName = (self.useSingle ? aclCollectionName : bucket);
        transaction.push(function (cb) {
            values = makeArray(values);
            self.db.collection(self.prefix + self.removeUnsupportedChar(collName), function (err, collection) {
                if (err instanceof Error) return cb(err);

                // build doc from array values
                let doc = {};
                values.forEach(function (value) {
                    doc[value] = true;
                });

                // update document
                collection.update(updateParams, {$set: doc}, {safe: true, upsert: true}).nodeify(function (err) {
                    if (err instanceof Error) return cb(err);
                    cb(undefined);
                });
            });
        });

        // transaction.push(function(cb) {
        //   self.db.collection(self.prefix + self.removeUnsupportedChar(collName), function(err,collection){
        //     // Create index
        //     collection.ensureIndex({_bucketname: 1, key: 1}, function(err){
        //       if (err instanceof Error) {
        //         return cb(err);
        //       } else{
        //         cb(undefined);
        //       }
        //     });
        //   });
        // })
    },

    /**
     Delete the given key(s) at the bucket
     */
    del: function (transaction, bucket, keys) {
        // contract(arguments)
        //     .params('array', 'string', 'string|array')
        //     .end();
        keys = makeArray(keys);
        let self = this;
        // let updateParams = (self.useSingle? {_bucketname: bucket, key:{$in:keys}} : {key:{$in:keys}});
        let updateParams = [];

        if (!_.isArray(keys)) {
            let key = (this.useSingle ? {_bucketname: bucket, key: keys} : {key: keys});
            updateParams.push(key);
        } else {
            keys.forEach((value) => {
                let key = (this.useSingle ? {_bucketname: bucket, key: value} : {key: value});
                updateParams.push(key);
            })
        }

        let collName = (self.useSingle ? aclCollectionName : bucket);

        transaction.push(function (cb) {
            self.db.collection(self.prefix + self.removeUnsupportedChar(collName), function (err, collection) {
                if (err instanceof Error) return cb(err);

                P.each(updateParams, (params) => {
                    return collection.remove(params, {safe: true})
                })
                    .nodeify(function (err) {
                        if (err instanceof Error) return cb(err);
                        cb(undefined);
                    });
            });
        });
    },

    /**
     Removes values from a given key inside a bucket.
     */
    remove: function (transaction, bucket, key, values) {
        // contract(arguments)
        //     .params('array', 'string', 'string|number','string|array|number')
        //     .end();
        key = encodeText(key);
        let self = this;
        let updateParams = (self.useSingle ? {_bucketname: bucket, key: key} : {key: key});
        let collName = (self.useSingle ? aclCollectionName : bucket);

        values = makeArray(values);
        transaction.push(function (cb) {
            self.db.collection(self.prefix + self.removeUnsupportedChar(collName), function (err, collection) {
                if (err instanceof Error) return cb(err);

                // build doc from array values
                let doc = {};
                values.forEach(function (value) {
                    doc[value] = true;
                });

                // update document
                collection.update(updateParams, {$unset: doc}, {safe: true, upsert: true}).nodeify(function (err) {
                    if (err instanceof Error) return cb(err);
                    cb(undefined);
                });
            });
        });
    },

    removeUnsupportedChar: function (text) {
        if (!this.useRawCollectionNames && (typeof text === 'string' || text instanceof String)) {
            text = decodeURIComponent(text);
            text = text.replace(/[/\s]/g, '_'); // replaces slashes and spaces
        }
        return text;
    }
}

function encodeText(text) {
    if (typeof text == 'string' || text instanceof String) {
        text = encodeURIComponent(text);
        text = text.replace(/\./g, '%2E');
    }
    return text;
}

function decodeText(text) {
    if (typeof text == 'string' || text instanceof String) {
        text = decodeURIComponent(text);
    }
    return text;
}

function encodeAll(arr) {
    if (Array.isArray(arr)) {
        let ret = [];
        arr.forEach(function (aval) {
            ret.push(encodeText(aval));
        });
        return ret;
    } else {
        return arr;
    }
}

function decodeAll(arr) {
    if (Array.isArray(arr)) {
        let ret = [];
        arr.forEach(function (aval) {
            ret.push(decodeText(aval));
        });
        return ret;
    } else {
        return arr;
    }
}

function fixKeys(doc) {
    if (doc) {
        let ret = {};
        for (let key in doc) {
            if (doc.hasOwnProperty(key)) {
                ret[decodeText(key)] = doc[key];
            }
        }
        return ret;
    } else {
        return doc;
    }
}

function fixAllKeys(docs) {
    if (docs && docs.length) {
        let ret = [];
        docs.forEach(function (adoc) {
            ret.push(fixKeys(adoc));
        });
        return ret;
    } else {
        return docs;
    }
}

function makeArray(arr) {
    return Array.isArray(arr) ? encodeAll(arr) : [encodeText(arr)];
}

exports = module.exports = MemdbBackend;
