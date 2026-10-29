const Compoundrules = [
  //particle position in compound words this only define particle positions and it surrounding tonkens.
//Rules names  are given Base on role of compound form except below rule 


  
  //compound  with particles
  
 /*particle here mean ပစ္စည်း ဝိဘတ် and သဗ္ဗန္ဓ doesnt include in here  
  *this rule name is written on presence of particle(ပစ္စည်း) not from final result.
  *That why this rules cant answer  pos|Role of compound word .  
  */
  
  { id: 'ps-01', seq: ['v','pt','pt'], 
    result: 'particle_stack_2' },
  { id: 'ps-02', seq: ['v','pt','pt','pt'], result: 'particle_stack_3' },
  { id: 'ps-03', seq: ['v','pt','pt','pt','pt'], result: 'particle_stack_4' },
  { id: 'ps-04', seq: ['v','pt','pt','pt','pt','pt'], result: 'particle_stack_5' },

  // Compound Noun
  { id: '1-a',  seq: ['n','n'],             result: 'compound_noun' },
  { id: '1-b',  seq: ['n','n','n'],         result: 'compound_noun' },
  { id: '1-c',  seq: ['n','v'],             result: 'compound_noun' },
  { id: '1-d',  seq: ['v','v'],             result: 'compound_noun' },
  { id: '1-e',  seq: ['v','v','n'],         result: 'compound_noun' },
  { id: '1-f',  seq: ['v','v','v','v'],     result: 'compound_noun' },
  { id: '1-g',  seq: ['n','v','aj'],        result: 'compound_noun' },
  { id: '1-h',  seq: ['n','aj','v'],        result: 'compound_noun' },
  { id: '1-i',  seq: ['n','n','v'],         result: 'compound_noun' },
  { id: '1-j',  seq: ['n','n','aj'],        result: 'compound_noun' },
  { id: '1-k',  seq: ['n','aj','n'],        result: 'compound_noun' },
  { id: '1-l',  seq: ['n','v','n','v'],     result: 'compound_noun' },
  { id: '1-m',  seq: ['n','aj','v','n'],    result: 'compound_noun' },
  { id: '1-n',  seq: ['n','v','n','n'],     result: 'compound_noun' },
  { id: '1-o',  seq: ['n','v','v','v','n'], result: 'compound_noun' },
  
  
  // Compound Verb
  { id: '2-a',  seq: ['v','v'],             result: 'compound_verb' },
  { id: '2-b',  seq: ['v','v','v'],         result: 'compound_verb' },
  { id: '2-c',  seq: ['v','v','v','v'],     result: 'compound_verb' },
  { id: '2-d',  seq: ['n','v'],             result: 'compound_verb' },
  { id: '2-e',  seq: ['n','aj','v'],        result: 'compound_verb' },
  { id: '2-f',  seq: ['aj','n','v'],        result: 'compound_verb' },
  { id: '2-g',  seq: ['n','v','v'],         result: 'compound_verb' },
  { id: '2-h',  seq: ['v','n','v'],         result: 'compound_verb' },
  { id: '2-i',  seq: ['n','n','v','v'],     result: 'compound_verb' },
  { id: '2-j',  seq: ['n','v','n','v'],     result: 'compound_verb' },


  // Compound Aaj
  { id: '3-a',  seq: ['aj','aj'],           result: 'compound_aj' },
  { id: '3-b',  seq: ['aj','aj','aj'],      result: 'compound_aj' },
  { id: '3-c',  seq: ['aj','aj','aj','aj'], result: 'compound_aj' },
  { id: '3-d',  seq: ['n','aj'],            result: 'compound_aj' },

  
  // Compound av
  { id: '4-a',  seq: ['v','v'],             result: 'compound_adv' },
  { id: '4-b',  seq: ['v','v','v','v'],     result: 'compound_adv' },
  { id: '4-c',  seq: ['aj','aj'],           result: 'compound_adv' },
  { id: '4-d',  seq: ['aj','aj','aj'],      result: 'compound_adv' },
  { id: '4-e',  seq: ['aj','aj','aj','aj'], result: 'compound_adv' },
  { id: '4-f',  seq: ['n','aj','dv'],       result: 'compound_adv' },
  { id: '4-g',  seq: ['n','n','v'],         result: 'compound_adv' },
  { id: '4-h',  seq: ['n','v','n','v'],     result: 'compound_adv' },
  { id: '4-i',  seq: ['n','n','n','v'],     result: 'compound_adv' },
];
