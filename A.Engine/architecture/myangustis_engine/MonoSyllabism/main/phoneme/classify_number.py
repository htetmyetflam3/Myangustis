import re
from myangustis_engine.MonoSyllabism.utilities.js_string import js_trim

def classify_number(token):
    text = js_trim(token)
    digits = re.sub(r'[^0-9၀-၉]', '', text)
    if re.match(r'^(၀၉|09)', digits) and 8 <= len(digits) <= 11:
        return {'rawPos': ['phone']}
    groups = [g for g in re.split(r'[.\-/,]', text) if g]
    numeric = all(re.fullmatch(r'[0-9၀-၉]+', g) for g in groups)
    if numeric and len(groups) == 3 and re.search(r'[.\-/]', text):
        return {'rawPos': ['exactdate']}
    if numeric and len(groups) == 1 and re.fullmatch(r'[0-9၀-၉]{4}', groups[0]):
        year = int(groups[0].translate(str.maketrans('၀၁၂၃၄၅၆၇၈၉', '0123456789')))
        if 1200 <= year <= 1400 or 1900 <= year <= 2100:
            return {'rawPos': ['year']}
    return {'rawPos': ['addr' if '/' in text else 'count']}
