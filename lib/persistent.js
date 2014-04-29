var fs = require('fs'),
	Promise = require('promise'),
	readFile = Promise.denodeify(fs.readFile),
	writeFile = Promise.denodeify(fs.writeFile);

module.exports = function loadPersistent(filename) {
	var obj = new PersistentObject(filename);
	return obj.load().then(function() {
		return obj;
	});
};;

function PersistentObject(filename) {
	if(!(this instanceof PersistentObject))
		return new PersistentObject(filename);

	this.load = function(f) {
		if(f)
			filename = f;
		if(!filename)
			throw new Error("No filename provided!");

		return readFile(filename, { encoding: 'utf-8' })
			.then(JSON.parse)
			.then(function(data) {
				this.data = data;
			}.bind(this));
	};

	this.save = function(f) {
		if(f) filename = f;
		return writeFile(filename, JSON.stringify(this.data));
	};

	this.data = {};
};
