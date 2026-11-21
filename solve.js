// solve.js — a faster drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly readCsv's answer for every input
// {text, header}: {columns, rows, errors}. Written from the
// reference's own policy (vendor/csv-reader/index.js in the kit),
// not from another parser:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is
//     no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled; "" inside it is one quote; each CRLF or lone CR inside
//     it is read as LF; what follows the closing quote, up to the next
//     comma or line break, is appended as it stands (quote_junk, when
//     the field ends); a quote that never closes is a literal
//     character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null;
//     rows are the records after it, each padded with "" (short_row,
//     with fields: its field count) or cut (long_row, with extra: the
//     cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; line is the
//     1-based line its record starts on (every LF, CRLF and lone CR
//     inside a quoted field counted), row its record's index in rows
//     (null for the header).
//
// Speed comes from never reading one character at a time: a record
// with no quote and no stray CR is split at once; a quoted field is
// found with indexOf and taken with slice; an unquoted field ends at
// the nearest of , \n \r, found with indexOf. Every indexOf is
// bounded by the nearest delimiter, so no scan ever runs past the
// field it is reading. Nothing is kept from one call to the next.

const QUOTE = 34; // "
const COMMA = 44; // ,
const LF = 10; // \n
const CR = 13; // \r
const BOM = 0xfeff;

// How a field ended.
const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === BOM) pos = 1;

  // The record being read: the line it starts on, and its index in
  // rows (null for the header). Set at each record's start.
  let recordLine = 1;
  let recordRow = null;

  // How the field just read ended, and how many characters the last
  // unquoted scan kept. `kept` matters only after a closing quote:
  // quote_junk fires when the junk after it kept a character.
  let ended = ENDED_END;
  let kept = 0;

  // Reads unquoted characters from pos onto `value` up to the next
  // comma or line break; a CR not followed by LF is dropped
  // (stray_cr). Sets `ended` and `kept`.
  function scanUnquoted(value) {
    kept = 0;
    while (pos < n) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      let end = -1;
      let kind = 0;
      if (comma !== -1) {
        end = comma;
        kind = COMMA;
      }
      if (lf !== -1 && (end === -1 || lf < end)) {
        end = lf;
        kind = LF;
      }
      if (end === -1) {
        // No comma or line break left: the rest is one field, but a
        // CR in it is still stray (no LF follows it anywhere).
        const chunk = text.slice(pos);
        const r = chunk.indexOf('\r');
        if (r === -1) {
          kept += chunk.length;
          pos = n;
          ended = ENDED_END;
          return value + chunk;
        }
        kept += r;
        value += chunk.slice(0, r);
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += r + 1;
        continue;
      }
      const chunk = text.slice(pos, end);
      const r = chunk.indexOf('\r');
      if (r === -1) {
        kept += chunk.length;
        value += chunk;
        pos = end + 1;
        if (kind === COMMA) {
          ended = ENDED_COMMA;
          return value;
        }
        line += 1;
        ended = ENDED_BREAK;
        return value;
      }
      // A CR comes before the comma or line break.
      kept += r;
      value += chunk.slice(0, r);
      const crPos = pos + r;
      if (crPos + 1 < n && text.charCodeAt(crPos + 1) === LF) {
        // CRLF: it ends the record (this only happens when the line
        // break found above is this CRLF's own LF).
        pos = crPos + 2;
        line += 1;
        ended = ENDED_BREAK;
        return value;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = crPos + 1;
    }
    ended = ENDED_END;
    return value;
  }

  // A quoted span holding "" or a line break: collapse "" to one
  // quote, read each CRLF or lone CR as one LF, and count the line
  // breaks it holds. Spans without those go through slice instead.
  function finishQuoted(span) {
    let value = '';
    let breaks = 0;
    let start = 0;
    let i = 0;
    const m = span.length;
    while (i < m) {
      const c = span.charCodeAt(i);
      if (c === QUOTE) {
        value += span.slice(start, i) + '"';
        i += 2;
        start = i;
        continue;
      }
      if (c === CR) {
        value += span.slice(start, i) + '\n';
        breaks += 1;
        i += span.charCodeAt(i + 1) === LF ? 2 : 1;
        start = i;
        continue;
      }
      if (c === LF) {
        value += span.slice(start, i) + '\n';
        breaks += 1;
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    value += span.slice(start);
    return { value, breaks };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && pos + 1 < n && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // A record with no quote and no stray CR on its first line ends
    // at that line break: split it at once.
    let nl = text.indexOf('\n', pos);
    const hasNl = nl !== -1;
    if (!hasNl) nl = n;
    let segEnd = nl;
    // Only a CR just before a real line break is a CRLF: a CR at the
    // very end of the text has no LF after it, so it is a lone CR and
    // must reach the slow path (stray_cr), not be stripped here.
    if (hasNl && segEnd > pos && text.charCodeAt(segEnd - 1) === CR) segEnd -= 1;
    const seg = text.slice(pos, segEnd);
    let fields;
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      fields = seg.split(',');
      pos = hasNl ? nl + 1 : n;
      if (hasNl) line += 1;
    } else {
      // The general path: field by field, quoted or not.
      fields = [];
      let quoted = false;
      do {
        if (text.charCodeAt(pos) === QUOTE) {
          quoted = true;
          const open = pos;
          const openLine = line;
          // Find the closing quote: the next quote that is not doubled.
          let q = pos + 1;
          let closed = -1;
          while (true) {
            q = text.indexOf('"', q);
            if (q === -1) break;
            if (text.charCodeAt(q + 1) === QUOTE) {
              q += 2;
              continue;
            }
            closed = q;
            break;
          }
          if (closed === -1) {
            // The quote never closes: it is a literal character, and
            // the text after it is read again as unquoted.
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            fields.push(scanUnquoted('"'));
            continue;
          }
          const span = text.slice(open + 1, closed);
          let value;
          if (span.indexOf('"') === -1 && span.indexOf('\r') === -1 && span.indexOf('\n') === -1) {
            value = span;
          } else {
            const done = finishQuoted(span);
            value = done.value;
            line += done.breaks;
          }
          pos = closed + 1;
          if (pos >= n) {
            fields.push(value);
            ended = ENDED_END;
            break;
          }
          const c = text.charCodeAt(pos);
          if (c === COMMA) {
            pos += 1;
            fields.push(value);
            ended = ENDED_COMMA;
          } else if (c === LF) {
            pos += 1;
            line += 1;
            fields.push(value);
            ended = ENDED_BREAK;
          } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
            pos += 2;
            line += 1;
            fields.push(value);
            ended = ENDED_BREAK;
          } else {
            // What follows the closing quote is appended as it
            // stands, up to the next comma or line break.
            const junk = scanUnquoted(value);
            if (kept > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            fields.push(junk);
          }
        } else {
          quoted = false;
          fields.push(scanUnquoted(''));
        }
      } while (ended === ENDED_COMMA);

      // A line that held only stray CRs is left with no characters:
      // no record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.slice(width) });
      fields.length = width;
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
