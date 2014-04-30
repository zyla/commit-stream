var ws = require('ws'),
	path = require('path'),
	fs = require('fs'),
	async = require('async'),
	GitWatch = require('./lib/git-watch'),
	EventEmitter = require('events').EventEmitter;

var config = require('./config');

var exclude = [ 'build', 'bin', 'classes', 'src', 'photos' ];

var repos = {};

// Find the damn repos
function traverse(basedir, dir, prefix, callback) {
	fs.readdir(path.join(basedir, dir), function(err, files) {
		if(err) { callback(null, []); return; } // ignore
		if(files.indexOf('HEAD') != -1 && files.indexOf('config') != -1) {
			var base = dir.replace(/\/?\.git$/, '');
			var repoName = path.join(prefix, base);
			console.log('Found repo: ' + repoName);
			repos[repoName] = new GitWatch(path.join(basedir, dir));
			callback(null, []);
		} else {
			async.map(files, function(file, callback) {
				if(file == '.git' || file[0] != '.' && exclude.indexOf(file) == -1)
					traverse(basedir, path.join(dir, file), prefix, callback);
				else
					callback(null, []);
			}, function(err, results) {
				if(err) throw err;
				callback(null, Array.prototype.concat.apply([], results));
			});
		}
	});
}

async.map(Object.keys(config.dirs), function(name, callback) {
	traverse(config.dirs[name], '', name, callback);
}, function() {
	console.log('OK, started.');

	Object.keys(repos).forEach(function(name) {
		repos[name].addListener('newCommits', ee.emit.bind(ee, 'newCommits', name));
	});
});

var ee = new EventEmitter();

var wss = new ws.Server({ port: 8097 });
wss.on('connection', function(ws) {
	function onNewCommits(repo, newCommits) {
		for(var i =  newCommits.length-1; i >= 0; i--) {
			var commit = newCommits[i];
			ws.send(JSON.stringify({ repo: repo, sha: commit.sha(),
				author: commit.author().toString(),
				committer: commit.committer().toString(),
				date: commit.date().toString(),
				message: commit.message().trim() }));
		}
	}

	ee.addListener('newCommits', onNewCommits);

	ws.on('close', function() {
		ee.removeListener('newCommits', onNewCommits);
	});
});
