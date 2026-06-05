content = open('index.js').read()

# Read raw line 107 to see exact bytes
lines = content.split('\n')
for i, line in enumerate(lines):
    if 'CLOSING TRIGGER' in line:
        print(f'Line {i+1} repr: {repr(line[-80:])}')
        # Fix: remove the trailing g](#keep)".`; from the end of this line
        if line.endswith('g](#keep)".`;'):
            lines[i] = line[:-len('g](#keep)".`;')]
            print('Fixed line!')
            break

new_content = '\n'.join(lines)
if new_content != content:
    open('index.js', 'w').write(new_content)
    print('File saved!')
else:
    print('No change made')
