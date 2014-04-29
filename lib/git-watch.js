var Repo = require('nodegit').Repo,
	Promise = require('promise'),
	fs = require('fs'),
	path = require('path'),
	EventEmitter = require('events').EventEmitter;

module.exports = GitWatch;

/**
 * `git log`-like function.
 * Takes callback : (commit: Commit, next: () -> void) -> void
 * Callback gets invoked for each commit while next() is called in callback
 */
function walkCommit(repo, commit, callback) {
	var rv = repo.createRevWalk();
	rv.push(commit.oid(), function() {
		next();

		function walk(err, oid) {
			if(err) throw err;
			if(oid) {
				repo.getCommit(oid, function(err, commit) {
					if(err) throw err;
					callback(commit, next);
				});
			} else {
				callback();
			}
		}
		function next() {
			rv.next(walk);
		}
	});
}

function GitWatch(dir) {
	this.master = null;
	this.refName = null;
	openRepo.call(this, dir);
}

GitWatch.prototype = Object.create(EventEmitter.prototype);

function createWatcher(refname) {
	fs.watch(path.join(this.repo.path(), refname),
			function(event, filename) {
		if(event == 'change') {
			masterChanged.call(this);
		}
	}.bind(this));
}

function refChanged(refname) {
	var oldMaster = this.master;
	var newCommits = [];
	this.repo.getBranch(refname, function(err, master) {
		if(err) throw err;
		this.master = master.sha();
		this.emit('masterChanged', this.master, oldMaster);
		walkCommit(this.repo, master, function(commit, next) {
			if(!commit && oldMaster) {
				// don't emit any events; commits deleted
				createWatcher.call(this);
			} else if(!commit || commit.sha() == oldMaster) {
				if(newCommits.length)
					this.emit('newCommits', newCommits, refname);
				createWatcher.call(this, refname);
			} else {
				newCommits.push(commit);
				next();
			}
		}.bind(this));
	}.bind(this));
}

function openRepo(dir) {
	var self = this;

	Repo.open(dir, function(err, repo) {
		if(err) throw err;
		self.repo = repo;
		repo.getReference('HEAD', function(err, ref) {
			if(err) throw err;
			ref.resolve(function(err, refname) {
				createWatcher.call(this, refname);
				self.emit('open');
			});
		});
	}.bind(this));
}
