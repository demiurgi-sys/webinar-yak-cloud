
import os

file_path = 'index.html'
css_link = '    <!-- External CSS -->\n    <link rel="stylesheet" href="assets/css/style.css">\n'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
in_style_block = False
style_removed = False

for line in lines:
    if '<style>' in line:
        in_style_block = True
        new_lines.append(css_link)
        style_removed = True
        continue
    
    if '</style>' in line:
        in_style_block = False
        continue
        
    if not in_style_block:
        new_lines.append(line)

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

if style_removed:
    print("Successfully removed style block and added link.")
else:
    print("Style block not found.")
