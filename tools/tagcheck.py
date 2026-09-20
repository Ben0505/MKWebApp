"""Finds mismatched block tags using a real HTML parser, so strings inside
scripts and attributes are not miscounted the way a regex would."""
import sys
from html.parser import HTMLParser

VOID = {'area','base','br','col','embed','hr','img','input','link','meta',
        'param','source','track','wbr'}
# Elements whose end tag is optional; ignore them for balance purposes.
OPTIONAL = {'li','tr','td','th','thead','tbody','tfoot','option','p'}

class Checker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.problems, self.in_script = [], [], False
    def handle_starttag(self, tag, attrs):
        if tag == 'script': self.in_script = True
        if self.in_script or tag in VOID or tag in OPTIONAL: return
        self.stack.append((tag, self.getpos()[0]))
    def handle_startendtag(self, tag, attrs): pass
    def handle_endtag(self, tag):
        if tag == 'script': self.in_script = False; return
        if self.in_script or tag in VOID or tag in OPTIONAL: return
        if not self.stack:
            self.problems.append((self.getpos()[0], f'</{tag}> with nothing open'))
            return
        if self.stack[-1][0] == tag:
            self.stack.pop(); return
        # look for it deeper in the stack
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                for t, ln in self.stack[i+1:]:
                    self.problems.append((ln, f'<{t}> opened here was never closed'))
                del self.stack[i:]
                return
        self.problems.append((self.getpos()[0], f'</{tag}> does not match any open tag'))

src = open(sys.argv[1]).read()
c = Checker(); c.feed(src)
for t, ln in c.stack:
    c.problems.append((ln, f'<{t}> opened here was never closed'))

lines = src.split('\n')
if not c.problems:
    print(f'  {sys.argv[1]}: balanced')
else:
    print(f'  {sys.argv[1]}: {len(c.problems)} problem(s)')
    for ln, msg in sorted(c.problems)[:8]:
        txt = lines[ln-1].strip()[:72] if 0 < ln <= len(lines) else ''
        print(f'    line {ln}: {msg}\n        {txt}')
