const fs = require('fs');
const path = require('path');
const { classMap } = require('./classMap');

// ---------- helper utilities ----------

function replaceClassInString(classString, conversions) {
  return classString
    .split(/(\s+)/)
    .map(part => {
      if (/^\s+$/.test(part)) return part;
      const trimmed = part.trim();
      if (classMap[trimmed]) {
        conversions.push({ from: trimmed, to: classMap[trimmed] });
        return classMap[trimmed];
      }
      return part;
    })
    .join('');
}

function mergeIntoParens(parensContent, mappedJoined) {
  const classAttrRegex = /class\s*=\s*(['"`])([\s\S]*?)\1/;
  if (classAttrRegex.test(parensContent)) {
    return parensContent.replace(classAttrRegex, (m, q, inner) => {
      const combined = `${inner} ${mappedJoined}`.replace(/\s+/g, ' ').trim();
      return `class=${q}${combined}${q}`;
    });
  } else {
    const trimmed = parensContent.trim();
    if (trimmed === '') {
      return `class="${mappedJoined}"`;
    } else {
      return `${trimmed}, class="${mappedJoined}"`;
    }
  }
}

// Return array of [startIndex, endIndex] pairs for top-level parentheses
function getParenRanges(line) {
  const ranges = [];
  const stack = [];
  let i = 0;
  const len = line.length;
  let inQuote = null;

  while (i < len) {
    const ch = line[i];

    if (inQuote) {
      if (ch === '\\' && i + 1 < len) {
        i += 2;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
      }
      i++;
      continue;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inQuote = ch;
        i++;
        continue;
      }

      if (ch === '(') {
        stack.push(i);
        i++;
        continue;
      }
      if (ch === ')') {
        const start = stack.pop();
        if (start !== undefined) {
          ranges.push([start, i]);
        }
        i++;
        continue;
      }
      i++;
    }
  }

  return ranges;
}

function isIndexInRanges(idx, ranges) {
  for (const [s, e] of ranges) {
    if (idx >= s && idx <= e) return true;
  }
  return false;
}

function looksLikePugAttributes(content) {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (/^\w+\s*=/.test(trimmed)) return true;
  if (/,\s*\w+\s*=/.test(trimmed)) return true;
  if (/&attributes\s*\(/.test(trimmed)) return true;
  if (/^[\w-]+\s*=\s*[^,]+(?:\s*,\s*[\w-]+\s*=\s*[^,]+)*$/.test(trimmed))
    return true;
  return false;
}

function isCodeContext(textBeforeParen) {
  const trimmed = textBeforeParen.trim();
  if (trimmed.endsWith('.')) return true;
  if (/\.\w+$/.test(trimmed)) return true;
  if (/[?:&|]\s*\w*$/.test(trimmed)) return true;
  if (/[+\-*/%=!<>&|]\s*\w*$/.test(trimmed)) return true;
  if (trimmed.includes('#{')) return true;
  if (/^\s*(return|if|else|while|for)\s/.test(trimmed)) return true;
  return false;
}

const HTML_TAGS = new Set([
  'div',
  'span',
  'a',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'header',
  'footer',
  'nav',
  'section',
  'article',
  'aside',
  'main',
  'img',
  'video',
  'audio',
  'canvas',
  'svg',
  'iframe',
  'label',
  'fieldset',
  'legend',
  'details',
  'summary',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'b',
  'i',
  'u',
  'br',
  'hr',
  'meta',
  'link',
  'script',
  'style',
  'title',
  'head',
  'body',
  'html',
  'base',
  'picture',
  'source',
  'track',
  'map',
  'area',
  'embed',
  'object',
  'param',
  'figure',
  'figcaption',
  'datalist',
  'output',
  'progress',
  'meter',
  'dialog',
  'small',
  'mark',
  'abbr',
  'cite',
  'q',
  'sup',
  'sub',
  's',
  'del',
  'ins',
  'wbr',
  'time',
  'kbd',
  'samp',
  'var',
  'caption',
  'colgroup',
  'col',
  'tfoot',
  'template',
  'slot',
  'noscript'
]);

function isLikelyPugTag(identifier, lineContext) {
  if (HTML_TAGS.has(identifier.toLowerCase())) return true;
  if (/^[A-Z]/.test(identifier)) return false;
  if (/\+\s*$/.test(lineContext)) return false;
  if (/^[a-z]+[A-Z]/.test(identifier)) return false;
  if (/^\s*$/.test(lineContext)) return true;
  return false;
}

function processPugLine(line, conversions) {
  function hasSpecialClassChars(str) {
    return /[:[/]/.test(str);
  }
  const isMixinCall = /^\s*\+/.test(line);
  if (isMixinCall) {
    const mixinMatch = line.match(
      /^(\s*\+\w+)(\([^)]*\))?((?:\.[a-zA-Z][\w-:]*)+)?\s*$/
    );

    if (!mixinMatch) return line;

    const [, mixinBase, propsPart = '', dotPart = ''] = mixinMatch;

    if (!dotPart) return line;

    const classNames = dotPart.split('.').filter(Boolean);

    const mappedClasses = classNames
      .map(cls => {
        if (classMap[cls]) {
          conversions.push({ from: cls, to: classMap[cls] });
          return classMap[cls];
        }
        return cls;
      })
      .filter(Boolean);

    const mappedJoined = mappedClasses.join(' ').replace(/\s+/g, ' ').trim();

    if (!hasSpecialClassChars(mappedJoined)) {
      const dotExpansion = mappedClasses
        .flatMap(c => c.split(/\s+/))
        .map(c => `.${c}`)
        .join('');

      return `${mixinBase}${propsPart}${dotExpansion}`;
    }

    return `${mixinBase}${propsPart}(class="${mappedJoined}")`;
  }

  const parenRanges = getParenRanges(line);

  // Process strings inside attribute parentheses
  const attributeParenRanges = [];
  for (const [start, end] of parenRanges) {
    const content = line.slice(start + 1, end);
    const beforeParen = line.slice(0, start);

    if (isCodeContext(beforeParen)) continue;
    if (!looksLikePugAttributes(content)) continue;

    const identifierMatch = beforeParen.match(/([a-zA-Z][\w-]*)$/);
    if (identifierMatch) {
      const identifier = identifierMatch[1];
      if (
        isLikelyPugTag(
          identifier,
          beforeParen.slice(0, beforeParen.length - identifier.length)
        )
      ) {
        attributeParenRanges.push([start, end]);
      }
    } else if (/\.[a-zA-Z][\w-]*\s*$/.test(beforeParen)) {
      attributeParenRanges.push([start, end]);
    }
  }

  // First pass: convert class strings inside parentheses
  let processed = line;
  for (let i = attributeParenRanges.length - 1; i >= 0; i--) {
    const [start, end] = attributeParenRanges[i];
    const content = line.slice(start + 1, end);

    const convertedContent = content.replace(
      /(["'`])([^"'`]*)\1/g,
      (match, quote, str) => {
        if (str.includes(' ') || /^[a-z-]+$/.test(str)) {
          const converted = replaceClassInString(str, conversions);
          return `${quote}${converted}${quote}`;
        }
        return match;
      }
    );

    processed =
      processed.slice(0, start + 1) + convertedContent + processed.slice(end);
  }

  line = processed;

  const currentParenRanges = getParenRanges(line);

  let idx = 0;

  while (idx < line.length) {
    if (isIndexInRanges(idx, currentParenRanges)) {
      idx++;
      continue;
    }

    const remainingLine = line.slice(idx);

    const dotMatch = remainingLine.match(
      /^((?:\.[a-zA-Z][\w-:]*)+)(?=\.|$|\s|\(|&|#)/
    );

    if (dotMatch) {
      const dotClasses = dotMatch[1];
      const dotStart = idx;
      const dotEnd = idx + dotClasses.length;

      const beforeDots = line.slice(0, dotStart);

      const hasParenBefore = beforeDots.trimEnd().endsWith(')');

      let tag = '';
      let tagStart = -1;

      if (hasParenBefore) {
        const parenBeforeDots = currentParenRanges
          .filter(([s, e]) => e < dotStart)
          .sort((a, b) => b[1] - a[1])[0];

        if (parenBeforeDots) {
          const [parenOpen, parenClose] = parenBeforeDots;
          const beforeParen = line.slice(0, parenOpen);
          const tagMatch = beforeParen.match(/([a-zA-Z][\w-]*)$/);

          if (
            tagMatch &&
            isLikelyPugTag(
              tagMatch[1],
              beforeParen.slice(0, beforeParen.length - tagMatch[1].length)
            )
          ) {
            tag = tagMatch[1];
            tagStart = parenOpen - tag.length;
          }
        }
      } else {
        const tagMatch = beforeDots.match(/([a-zA-Z][\w-]*)$/);

        if (tagMatch) {
          const potentialTag = tagMatch[1];
          const beforeTag = beforeDots.slice(
            0,
            beforeDots.length - potentialTag.length
          );

          if (isLikelyPugTag(potentialTag, beforeTag)) {
            tag = potentialTag;
            tagStart = dotStart - tag.length;
          }
        }
      }

      if (isCodeContext(beforeDots)) {
        idx++;
        continue;
      }

      const classNames = dotClasses.split('.').filter(Boolean);
      const mappedClasses = classNames
        .map(cls => {
          const trimmed = cls.trim();
          if (classMap[trimmed]) {
            conversions.push({ from: trimmed, to: classMap[trimmed] });
            return classMap[trimmed];
          }
          return trimmed;
        })
        .filter(Boolean);

      const mappedJoined = mappedClasses.join(' ').replace(/\s+/g, ' ').trim();

      if (hasParenBefore) {
        if (hasSpecialClassChars(mappedJoined)) {
          const parenBeforeDots = currentParenRanges
            .filter(([s, e]) => e < dotStart)
            .sort((a, b) => b[1] - a[1])[0];

          if (parenBeforeDots) {
            const [parenOpen, parenClose] = parenBeforeDots;
            const insideParens = line.slice(parenOpen + 1, parenClose);
            const mergedInside = mergeIntoParens(insideParens, mappedJoined);

            line =
              line.slice(0, parenOpen + 1) +
              mergedInside +
              line.slice(parenClose, dotStart) +
              line.slice(dotEnd);

            idx = parenOpen + 1 + mergedInside.length;

            currentParenRanges.length = 0;
            currentParenRanges.push(...getParenRanges(line));
            continue;
          }
        } else {
          const dotExpansion = mappedClasses
            .flatMap(m => m.split(/\s+/))
            .filter(Boolean)
            .map(c => `.${c}`)
            .join('');

          line = line.slice(0, dotStart) + dotExpansion + line.slice(dotEnd);

          idx = dotStart + dotExpansion.length;
          continue;
        }
      }

      // NEW: Look for parentheses after the dots, potentially with &attributes in between
      const afterDots = line.slice(dotEnd);

      // Check for &attributes() followed by parentheses: .classes&attributes(...)(...)
      const attributesWithParenMatch = afterDots.match(
        /^&attributes\s*\([^)]*\)\s*\(/
      );

      // Check for just parentheses: .classes(...)
      const hasParenAfter = afterDots.match(/^\s*\(/);

      // Find the target parentheses to merge into
      let targetParenRange = null;

      if (attributesWithParenMatch) {
        // Find the parentheses AFTER &attributes()
        const attributesEndPos =
          dotEnd + attributesWithParenMatch[0].length - 1;
        targetParenRange = currentParenRanges.find(
          ([s, e]) => s === attributesEndPos
        );
      } else if (hasParenAfter) {
        // Find the parentheses directly after the dots
        targetParenRange = currentParenRanges.find(([s, e]) => s >= dotEnd);
      }

      if (targetParenRange) {
        if (hasSpecialClassChars(mappedJoined)) {
          const [parenOpen, parenClose] = targetParenRange;
          const insideParens = line.slice(parenOpen + 1, parenClose);
          const mergedInside = mergeIntoParens(insideParens, mappedJoined);

          const actualTag = tag || 'div';
          const replaceStart = tagStart >= 0 ? tagStart : dotStart;

          // Keep everything between the dots and the target paren (including &attributes)
          const middlePart = line.slice(dotEnd, parenOpen);

          line =
            line.slice(0, replaceStart) +
            actualTag +
            middlePart +
            '(' +
            mergedInside +
            ')' +
            line.slice(parenClose + 1);

          idx =
            replaceStart +
            actualTag.length +
            middlePart.length +
            mergedInside.length +
            2;

          currentParenRanges.length = 0;
          currentParenRanges.push(...getParenRanges(line));
          continue;
        } else {
          const dotExpansion = mappedClasses
            .flatMap(m => m.split(/\s+/))
            .filter(Boolean)
            .map(c => `.${c}`)
            .join('');

          const actualTag = tag || '';
          const replaceStart = tagStart >= 0 ? tagStart : dotStart;

          line =
            line.slice(0, replaceStart) +
            actualTag +
            dotExpansion +
            line.slice(dotEnd);

          idx = replaceStart + actualTag.length + dotExpansion.length;
          continue;
        }
      }

      // No parentheses nearby - need to handle differently
      if (hasSpecialClassChars(mappedJoined)) {
        const actualTag = tag || 'div';
        const replaceStart = tagStart >= 0 ? tagStart : dotStart;

        line =
          line.slice(0, replaceStart) +
          `${actualTag}(class="${mappedJoined}")` +
          line.slice(dotEnd);

        idx = replaceStart + actualTag.length + mappedJoined.length + 10;
      } else {
        const dotExpansion = mappedClasses
          .flatMap(m => m.split(/\s+/))
          .filter(Boolean)
          .map(c => `.${c}`)
          .join('');

        const replaceStart = tagStart >= 0 ? tagStart : dotStart;
        const replacement = (tag || '') + dotExpansion;

        line = line.slice(0, replaceStart) + replacement + line.slice(dotEnd);

        idx = replaceStart + replacement.length;
      }

      currentParenRanges.length = 0;
      currentParenRanges.push(...getParenRanges(line));
    } else {
      idx++;
    }
  }

  return line;
}

// ---------- main convertClasses ----------

function convertClasses(content, fileExt) {
  let converted = content;
  const conversions = [];

  // Pattern 1: Simple class/className with quotes
  converted = converted.replace(
    /\b(class(?:Name)?)\s*=\s*(["'])([^"']*)\2/g,
    (match, attr, quote, classes) => {
      const newClasses = replaceClassInString(classes, conversions);
      return `${attr}=${quote}${newClasses}${quote}`;
    }
  );

  // Pattern 2: Template literals with backticks
  converted = converted.replace(
    /\b(class(?:Name)?)\s*=\s*`([^`]*)`/g,
    (match, attr, content) => {
      const processed = content.replace(/([^${}]+)|\$\{[^}]+\}/g, part => {
        if (part.startsWith('${')) return part;
        return replaceClassInString(part, conversions);
      });
      return `${attr}=\`${processed}\``;
    }
  );

  // Pattern 3: JSX with curly braces and strings
  converted = converted.replace(
    /\b(class(?:Name)?)\s*=\s*\{\s*(["'])([^"']*)\2\s*\}/g,
    (match, attr, quote, classes) => {
      const newClasses = replaceClassInString(classes, conversions);
      return `${attr}={${quote}${newClasses}${quote}}`;
    }
  );

  // Pattern 4: JSX with curly braces and template literals
  converted = converted.replace(
    /\b(class(?:Name)?)\s*=\s*\{\s*`([^`]*)`\s*\}/g,
    (match, attr, content) => {
      const processed = content.replace(/([^${}]+)|\$\{[^}]+\}/g, part => {
        if (part.startsWith('${')) return part;
        return replaceClassInString(part, conversions);
      });
      return `${attr}={\`${processed}\`}`;
    }
  );

  // Pattern 5: String concatenation in JSX
  converted = converted.replace(
    /\b(class(?:Name)?)\s*=\s*\{([^}]+)\}/g,
    (match, attr, expr) => {
      if (!/["'`]/.test(expr)) return match;
      const processed = expr.replace(
        /(["'`])([^"'`]*)\1/g,
        (strMatch, quote, str) => {
          const newStr = replaceClassInString(str, conversions);
          return `${quote}${newStr}${quote}`;
        }
      );
      return `${attr}={${processed}}`;
    }
  );

  // Pattern 6: Pug dot notation
  if (fileExt === '.pug' || fileExt === '.jade') {
    const lines = converted.split('\n');
    for (let i = 0; i < lines.length; i++) {
      lines[i] = processPugLine(lines[i], conversions);
    }
    converted = lines.join('\n');
  }

  // Pattern 7: clsx/classnames/cn
  converted = converted.replace(
    /\b(clsx|classnames|cn)\s*\(([^)]+)\)/g,
    (match, func, args) => {
      const processed = args.replace(
        /(["'`])([^"'`]*)\1/g,
        (strMatch, quote, str) => {
          const newStr = replaceClassInString(str, conversions);
          return `${quote}${newStr}${quote}`;
        }
      );
      return `${func}(${processed})`;
    }
  );

  return { converted, conversions };
}

// ---------- file processing ----------

function processFile(filePath, outputDir) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileExt = path.extname(filePath);
  const { converted, conversions } = convertClasses(content, fileExt);

  const outputPath = path.join(outputDir, path.basename(filePath));
  fs.writeFileSync(outputPath, converted, 'utf-8');

  return { filePath, outputPath, conversions };
}

function processDirectory(inputDir, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const files = fs.readdirSync(inputDir);
  const results = [];
  const supportedExtensions = [
    '.html',
    '.pug',
    '.jade',
    '.jsx',
    '.tsx',
    '.js',
    '.ts'
  ];

  files.forEach(file => {
    const filePath = path.join(inputDir, file);
    const stat = fs.statSync(filePath);
    const fileExt = path.extname(file);
    if (stat.isFile() && supportedExtensions.includes(fileExt)) {
      results.push(processFile(filePath, outputDir));
    } else if (stat.isDirectory()) {
      const subOutputDir = path.join(outputDir, file);
      const subResults = processDirectory(filePath, subOutputDir);
      results.push(...subResults);
    }
  });
  return results;
}

// ---------- CLI ----------

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Bootstrap 5 to Tailwind CSS Converter');
  console.log('Usage:');
  console.log('  In-place:  node converter.js <directory>');
  console.log('  Copy mode: node converter.js <input-dir> <output-dir>');
  process.exit(1);
}

const inputDir = args[0];
const outputDir = args[1] || inputDir;
const inPlace = !args[1];

if (!fs.existsSync(inputDir)) {
  console.error(`Error: Directory "${inputDir}" does not exist`);
  process.exit(1);
}

if (inPlace) {
  console.log('🔄 Converting Bootstrap classes to Tailwind (IN-PLACE)...');
  console.log(
    '⚠️  Files will be modified directly. Make sure you have a backup!\n'
  );
} else {
  console.log('🔄 Converting Bootstrap classes to Tailwind...\n');
}

const results = processDirectory(inputDir, outputDir);

console.log('✅ Conversion complete!\n');
console.log(`Processed ${results.length} file(s)`);
if (!inPlace) {
  console.log(`Output directory: ${outputDir}`);
}
console.log('');

results.forEach(result => {
  console.log(`📄 ${path.basename(result.filePath)}`);
  console.log(`   ✓ ${result.conversions.length} classes converted`);
  console.log('');
});

console.log('💡 Next steps:');
console.log('1. Review the converted files');
console.log('2. Install Tailwind CSS if not already installed');
console.log('3. Test your converted pages');
console.log('4. Manually adjust any unmapped classes');
