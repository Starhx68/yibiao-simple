import re
s = '![' + 'a'*10 + '](data:image/png;base64,' + 'b'*10000 + ')'
p = r'(\*\*.*?\*\*|\*.*?\*|`.*?`|!\[.*?\]\(.*?\))'
parts = re.split(p, s)
print("Length:", len(parts))
print("Parts:", parts[:3])
