const path = require('path');
const { promisify } = require('util');
const { watch } = require('chokidar');
const fs = require('fs-extra');
const { Queue } = require('./q.js');


const args = {
  watch: process.argv.includes('--watch'),
  skip_initial: process.argv.includes('--skip-init'),
  ignore: (idx => {
    if (idx === -1) return [];
    if (process.argv[idx].includes('=')) {
      return process.argv[idx].split('=')[1].split(',');
    }
    const acc = [];
    for (let i = idx + 1; i< process.argv.length; i++) {
      const arg = process.argv[i];
      if (/^--\w+/.test(arg)) break;
      acc.push(...(arg?.split(',') || []));
    }
    return acc;
  })(process.argv.findIndex((arg) => arg.includes('--ignore')))
    .map(pat => path.resolve(process.cwd(), pat)),
};

if (args.skip_initial && !args.watch) {
  console.error('nothing to do');
  process.exit();
}

const delay = promisify(setTimeout);

const q = new Queue;

const SRC_PATH = path.resolve(process.cwd());
const dirs = [path.join(SRC_PATH, '**/*.rs')];


const handle_file_change = async (file_path, _stats) => {
  await delay(100);
  q.push(async () => {
    try {
      await handle_file(file_path);
    } catch (e) {
      console.error(e);
    }
  });
  console.debug('Queued ', file_path);
};


watch(dirs, { ignored: [/\/target\//, ...args.ignore], ignoreInitial: args.skip_initial })
  .on('change', handle_file_change)
  .on('add', handle_file_change)
  .on('ready', () => {
    if (!args.watch) process.exit();
    console.log(`Watching files in`, dirs);
  });


async function handle_file(file_path) {
  console.log('Handling ', file_path);
  const abs_module_path = get_module_path_absolute(file_path);

  const parent_info = await get_parent(file_path);
  if (!parent_info) {
    console.log(`Couldn't find parent info of ${file_path}`);
    return;
  }

  await ensure_include(/::(\w+)$/.exec(abs_module_path)[1], parent_info);
}

function get_module_path_absolute(file_path) {
  const from_root = path.relative(SRC_PATH, file_path).replace(/\.rs/, '').replace(/\/mod$/, '');
  return 'crate::' + from_root.replaceAll('/', '::');
}

async function get_parent(file_path) {
  const is_mod_itself = /\/mod\.rs$/.test(file_path);
  let parent_mod_path = (
    is_mod_itself
      ? path.dirname(file_path.replace(/\/mod\.rs$/, ''))
      : path.dirname(file_path)
  ) + '/mod.rs';
  if (!await fs.exists(parent_mod_path)) {
    parent_mod_path = parent_mod_path.replace(/\/mod\.rs$/, '/lib.rs');
    if (!await fs.exists(parent_mod_path)) {
      console.log(`Couldn't find parent mod for ${file_path}`);
      return null;
    }
  }
  try {
    let text = await fs.readFile(parent_mod_path, 'utf8');
    return [parent_mod_path, text];
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function ensure_mod(module_name, parent_text) {
  if (module_name === 'lib') {
    console.log('It looks like a lib.rs to me - skipping');
    return [false];
  }
  if (!parent_text.includes(`mod ${module_name};`)) {
    const mod_line = `pub mod ${module_name};`;
    {
      let last;
      parent_text.replace(/(pub )?mod \w+;/g, (match, _pub, idx, _whole) => {
        last = [idx, match.length];
        return match;
      });
      if (last) {
        const idx = last[0] + last[1];
        const out = `${parent_text.slice(0, idx)}\n${mod_line}${parent_text.slice(idx)}`;
        console.log(`Added "${mod_line}"`);
        return [true, out];
      }
    }

    return [true, mod_line + '\n' + parent_text];
  } else {
    console.log(`Already present: "mod ${module_name};"`);
    return [false];
  }
}

async function ensure_include(module_name, [parent_path, text]) {
  let changed = false;

  const [mod_added, out_text] = await ensure_mod(module_name, text);
  if (mod_added) {
    changed = true;
    text = out_text;
  }

  if (changed) {
    console.log(`Writing out to ${parent_path}`);
    await fs.writeFile(parent_path, text);
  }
}

