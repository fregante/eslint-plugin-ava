#!/usr/bin/env node
const path = require('path');
const process = require('process');
const Listr = require('listr');
const tempy = require('tempy');
const execa = require('execa');
const del = require('del');
const chalk = require('chalk');

const packages = new Map([
	['chalk', 'https://github.com/chalk/chalk'],
	['wrap-ansi', 'https://github.com/chalk/wrap-ansi'],
	['np', 'https://github.com/sindresorhus/np'],
	['ora', 'https://github.com/sindresorhus/ora'],
	['p-map', 'https://github.com/sindresorhus/p-map'],
	['os-locale', 'https://github.com/sindresorhus/os-locale'],
	['execa', 'https://github.com/sindresorhus/execa'],
	['pify', 'https://github.com/sindresorhus/pify'],
	['boxen', 'https://github.com/sindresorhus/boxen'],
	['make-dir', 'https://github.com/sindresorhus/make-dir'],
	['listr', 'https://github.com/SamVerschueren/listr'],
	['listr-update-renderer', 'https://github.com/SamVerschueren/listr-update-renderer'],
	['bragg', 'https://github.com/SamVerschueren/bragg'],
	['bragg-router', 'https://github.com/SamVerschueren/bragg-router'],
	['dev-time', 'https://github.com/SamVerschueren/dev-time'],
	['decode-uri-component', 'https://github.com/SamVerschueren/decode-uri-component'],
	['to-ico', 'https://github.com/kevva/to-ico'],
	['download', 'https://github.com/kevva/download'],
	['brightness', 'https://github.com/kevva/brightness'],
	['decompress', 'https://github.com/kevva/decompress'],
	['npm-conf', 'https://github.com/kevva/npm-conf'],
	['imagemin', 'https://github.com/imagemin/imagemin'],
	['color-convert', 'https://github.com/qix-/color-convert'],
	['eslint-plugin-unicorn', 'https://github.com/sindresorhus/eslint-plugin-unicorn'],
	['ky', 'https://github.com/sindresorhus/ky'],
	['query-string', 'https://github.com/sindresorhus/query-string'],
	['meow', 'https://github.com/sindresorhus/meow'],
	['emittery', 'https://github.com/sindresorhus/emittery'],
	['p-queue', 'https://github.com/sindresorhus/p-queue'],
	['pretty-bytes', 'https://github.com/sindresorhus/pretty-bytes'],
	['normalize-url', 'https://github.com/sindresorhus/normalize-url'],
	['pageres', 'https://github.com/sindresorhus/pageres'],
	// Disabled for now: https://github.com/avajs/eslint-plugin-ava/runs/2044891483?check_suite_focus=true
	// ['got', 'https://github.com/sindresorhus/got']
]);

const typescriptPackages = new Set([
	'pageres',
	'got',
	'p-queue',
]);

const cwd = path.join(__dirname, 'eslint-config-ava-tester');

const enrichErrors = (packageName, cliArgs, f) => async (...args) => {
	try {
		return await f(...args);
	} catch (error) {
		error.packageName = packageName;
		error.cliArgs = cliArgs;
		throw error;
	}
};

const makeEslintTask = (packageName, dest, extraArgs = []) => {
	const isTypescriptPackage = typescriptPackages.has(packageName);
	const typescriptArgs = isTypescriptPackage ? ['--parser', '@typescript-eslint/parser', '--ext', '.ts'] : [];

	const args = ['eslint', '--format', 'json', '--config', path.join(cwd, 'index.js'), dest, ...typescriptArgs, ...extraArgs];

	return enrichErrors(packageName, args, async () => {
		let stdout;
		let processError;
		try {
			({stdout} = await execa('npx', args, {cwd, localDir: __dirname}));
		} catch (error) {
			({stdout} = error);
			processError = error;

			if (!stdout) {
				throw error;
			}
		}

		let files;
		try {
			files = JSON.parse(stdout);
		} catch (error) {
			console.error('Error while parsing eslint output:', error);

			if (processError) {
				throw processError;
			}

			throw error;
		}

		for (const file of files) {
			for (const message of file.messages) {
				if (message.fatal) {
					const error = new Error(message.message);
					error.eslintFile = file;
					error.eslintMessage = message;
					throw error;
				}
			}
		}
	});
};

const execute = name => {
	const dest = tempy.directory();

	return new Listr([
		{
			title: 'Cloning',
			task: () => execa('git', ['clone', packages.get(name), '--single-branch', dest]),
		},
		{
			title: 'Running eslint',
			task: makeEslintTask(name, dest),
		},
		{
			title: 'Running eslint --fix',
			task: makeEslintTask(name, dest, ['--fix-dry-run']),
		},
		{
			title: 'Clean up',
			task: () => del(dest, {force: true}),
		},
	].map(({title, task}) => ({
		title: `${name} / ${title}`,
		task,
	})), {
		exitOnError: false,
	});
};

const list = new Listr([
	{
		title: 'Setup',
		task: () => execa('npm', ['install', '../../..', 'eslint', 'babel-eslint', 'typescript', '@typescript-eslint/parser'], {cwd}),
	},
	{
		title: 'Integration tests',
		task: () => {
			const tests = new Listr({concurrent: true});

			for (const [name] of packages) {
				tests.add([
					{
						title: name,
						task: () => execute(name),
					},
				]);
			}

			return tests;
		},
	},
], {
	renderer: process.env.INTEGRATION ? 'verbose' : 'default',
});

list.run()
	.catch(error => {
		if (error.errors) {
			for (const error2 of error.errors) {
				console.error('\n', chalk.red.bold.underline(error2.packageName), chalk.gray('(' + error2.cliArgs.join(' ') + ')'));
				console.error(error2.message);

				if (error2.stderr) {
					console.error(chalk.gray(error2.stderr));
				}

				if (error2.eslintMessage) {
					console.error(chalk.gray(error2.eslintFile.filePath), chalk.gray(JSON.stringify(error2.eslintMessage, null, 2)));
				}
			}
		} else {
			console.error(error);
		}

		process.exit(1);
	});
