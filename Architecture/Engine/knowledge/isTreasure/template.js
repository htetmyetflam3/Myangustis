/* Sentence Templates — static declarations only */
export const SyllableSchema = { main:'syllable', posFamily:null, pos:null, unit:null, relation:null, role:null };
export const SentenceProfile  = { main:'sentence', variable:null, style:null, st:null };
export const ClauseProfile    = { main:'clause', variable:null, connector:null, function:null };

/* ── LSE ── */
const LSEw={noun:{ကတ္တားဝိဘတ်:[],ကံဝိဘတ်:['ကို'],ထွက်ခွာရာပြဝိဘတ်:['မှ'],ရှေးရှုရာပြဝိဘတ်:[],ဆိုက်ရောက်ရာပြဝိဘတ်:['ထိ','အထိ','ထိအောင်'],အသုံးခံပြဝိဘတ်:[],အကြောင်းပြဝိဘတ်:['ကြောင့်'],လက်ခံပြဝိဘတ်:['အား'],နေရာပြဝိဘတ်:['၌','တွင်','မှာ'],အချိန်ပြဝိဘတ်:['က'],ပိုင်ဆိုင်ခြင်းပြဝိဘတ်:['၏'],လိုက်လျောပြဝိဘတ်:['အရ','အတိုင်း','အလိုက်','အလျောက်','အားလျော်စွာ','နှင့်အညီ','နှင့်အမျှ'],ယှဉ်တွဲပြဝိဘတ်:['နှင့်အတူ','နှင့်တကွ'],ခွဲထုတ်ရာပြဝိဘတ်:['အနက်','အထဲမှာ','အထဲမှ'],ရည်စူးချက်ပြဝိဘတ်:['ငှာ','အလို့ငှာ','ဖို့','အဖို့','အတွက်'],နေရာဆက်တိုက်ပြဝိဘတ်:[],အချိန်ဆက်တိုက်ပြဝိဘတ်:['ပတ်လုံး','လုံးလုံး'],disambiguate:['က','မှာ','သို့','ဖြင့်','နှင့်','၌','တွင်','ဝယ်','တိုင်တိုင်','တိုင်အောင်']},verb:{ပစ္စုပ္ပန်ကာလပြကြိယာဝိဘတ်:[],အတိတ်ကာလပြကြိယာဝိဘတ်:['ပြီ'],အနာဂတ်ကာလပြကြိယာဝိဘတ်:['မည်','လိမ့်မည်','အံ့','လတ္တံ့'],စေခိုင်းဝိဘတ်:['လော့'],ညှိနှိုင်းဝိဘတ်:['စို့','ရအောင်'],ဆန္ဒညွှန်ဝိဘတ်:['ပါရစေ','ပါစေ'],အမိန့်ချဝိဘတ်:['စေ']}};
const LSEp={noun:{မျိုးပြပစ္စည်း:['ကောင်','ခု','ခွန်း','စောင်','ဆူ','ထည်','ပါး','ယောက်','လက်','ဖုံ'],လိင်ညွှန်းပစ္စည်း:['သား','ထီး','ဖ','ဖို','မောင်','ကို','ဖိုး','ဦး','သူ','မ','မိ','မယ်','ဒေါ်'],ကိန်းညွှန်းပစ္စည်း:['တို့','တိတိ','ကျ','စီ','ကျစီ','လုံး','စလုံး','တည်း','လျှင်','ကျော်','ခန့်','လောက်','ကြိမ်','ခါ','ခေါက်','မြောက်'],နာမ်ထောက်ပစ္စည်း:['သာ','သာလျှင်','ချည်း','ရော','လည်း','တောင်'],ဥပမာပစ္စည်း:['ကဲ့သို့','လို','နှယ်','အတိုင်း'],ရူပကပစ္စည်း:['တည်းဟူသော'],အာလုပ်ပစ္စည်း:['အို','ဟယ်','ရေ','ဗျို့','ခင်ဗျာ','ဟေ့'],ဝိစ္ဆာပစ္စည်း:['တိုင်း','တကာ'],disambiguate:['ပင်','များ']},verb:{အမေးပစ္စည်း:['နည်း','လော','စ','လား','လဲ','တုံး'],ကိန်းညွှန်းပစ္စည်း:['ကြ','ကုန်','ကြကုန်'],ကြိယာထောက်ပစ္စည်း:['ချင်','တတ်','နိုင်','ဖူး','ဝံ့','ခဲ','ခဲ့','မိ','သင့်','ရှာ','လွန်း','လှ','ရက်','သေး','ဦး','အပ်','ရ','ထိုက်','နေ','ပြန်','နှင့်','သွား','ရစ်','ထား','ပျော်','ပစ်'],အငြင်းပြပစ္စည်း:['မ','မ…ဘူး'],ဝါကျနောက်လိုက်ပစ္စည်း:['ကွာ','ကွယ်','နော်','ပေါ့','လေ','ပေါ့ဗျာ','ပေါ့လေ','လေကွယ်'],disambiguate:['ပါ','လို့']},word_changer:{နာမ်ပုဒ်ပြောင်းပစ္စည်း:{ကြိယာနာမ်ပုဒ်ပြောင်းပစ္စည်း:['ချက်','ဖွယ်','စရာ','ဖို့','ရန်','အ-အ'],ဂုဏ်ရည်ပြနာမ်ပုဒ်ပြောင်းပစ္စည်း:[]},နာမဝိသေသနပုဒ်ပြောင်းပစ္စည်း:['သော','သည့်','မည့်'],ကြိယာဝိသေသနပုဒ်ပြောင်းပစ္စည်း:['စွာ','တ-တ','အ-တ','ချည်-ချည်'],disambiguate:['အ','ခြင်း','မှု']},disambiguate:['တော့','ဗျာ','ရှင်','အ','ပါ']};
const LSEt={clause:{ပုဒ်ဆက်သမ္ဗန္ဓ:['လည်းကောင်း','ရော','ပါ','ရောရော','ဖြစ်ဖြစ်','မှတစ်ပါး'],နှိုင်းယှဉ်ပြသမ္ဗန္ဓ:['သလို','ထက်'],ပေါင်းစည်းပြသမ္ဗန္ဓ:['လည်း','လည်း…လည်း','အပြင် လည်း','အပြင်…လည်း','သာမက…လည်း','သာမဟုတ်…လည်း'],ရွေးချယ်ပြသမ္ဗန္ဓ:[],ကန့်သတ်ချက်ပြသမ္ဗန္ဓ:['က'],ကန့်သတ်မဲ့ပြသမ္ဗန္ဓ:['ဖြစ်စေ…ဖြစ်စေ','ဖြစ်စေ…မ…ဖြစ်စေ','သော်လည်းကောင်း…ဖြစ်စေ','သော်လည်းကောင်း…သော်လည်းကောင်း','သော်လည်းကောင်း…မ…သော်လည်းကောင်း'],တစ်ပြိုင်နက်ပြသမ္ဗန္ဓ:[],disambiguate:['နှင့်','ဖြစ်စေ','သို့မဟုတ်','သော်လည်းကောင်း']},sentence:{ဝါကျဆက်သမ္ဗန္ဓ:['စေရန်'],အဓိပ္ပယ်ဆက်သမ္ဗန္ဓ:['အကြောင်းမူကား','ထို့ပြင်','ထို့နောက်','ထိုအခါ'],ဆန့်ကျင်ပြသမ္ဗန္ဓ:['လင့်ကစား','စေကာမူ','လျက်နှင့်','မ……ဘဲလျက်'],အချိန်ပြသမ္ဗန္ဓ:['မှစ၍','တိုင်','တိုင်အောင်','အခါတိုင်း','စဉ်','တုန်း','သမျှ','မ…မီ','မ…မချင်း','သောအခါ','တိုင်း'],အကျိုးမျှော်ပြသမ္ဗန္ဓ:['အောင်','ရန်','ဖို့','ရန်အလို့ငှာ','ရန်အတွက်','အံ့သောငှာ','စိမ့်သောငှာ'],အကြောင်းပြသမ္ဗန္ဓ:['သောကြောင့်','သဖြင့်','လို့','သို့ဖြစ်၍'],တစ်ခုပြီးတစ်ခုပြသမ္ဗန္ဓ:[],disambiguate:['နှင့်တစ်ပြိုင်နက်','သော်လည်း','သို့ရာတွင်','၍','ထို့ကြောင့်','အဘယ်ကြောင့်ဆိုသော်']},disambiguate:['သကဲ့သို့','လျှင်','လျက်','ကာ','ရင်း','မှ']};

/* ── LSN (clone of LSE except pyitsi verb အမေးပစ္စည်း) ── */
const LSNw=JSON.parse(JSON.stringify(LSEw));
const LSNp=JSON.parse(JSON.stringify(LSEp));
LSNp.verb['အမေးပစ္စည်း']=['လား','လဲ','တုံး'];
const LSNt=JSON.parse(JSON.stringify(LSEt));

export const LSE_Map={wibat:LSEw,pyitsi:LSEp,thanbanda:LSEt};
export const LSN_Map={wibat:LSNw,pyitsi:LSNp,thanbanda:LSNt};

/* ── StyleSets ── */
export const StyleSets={
  E:new Set([...Object.values(LSEw.noun).flat(),...Object.values(LSEw.verb).flat(),...Object.values(LSEp.noun).flat(),...Object.values(LSEp.verb).flat(),...Object.values(LSEt.clause).flat(),...Object.values(LSEt.sentence).flat()].filter(Boolean)),
  N:new Set([...Object.values(LSNw.noun).flat(),...Object.values(LSNw.verb).flat(),...Object.values(LSNp.noun).flat(),...Object.values(LSNp.verb).flat(),...Object.values(LSNt.clause).flat(),...Object.values(LSNt.sentence).flat()].filter(Boolean)),
};

/* ── QS Bridge ── */
export const QS_Bridge={
  E_to_N:{'သနည်း':['သလဲ','သလား','တုံး','လား','လဲ'],'မည်နည်း':['မလား'],'မည်လော':['မလဲ']},
  N_to_E:{'သလဲ':'သနည်း','သလား':'သနည်း','တုံး':'သနည်း','လား':'သနည်း','လဲ':'သနည်း','မလား':'မည်နည်း','မလဲ':'မည်လော'}
};

/* ── Zip Registry ── */
export const _particleToClass=new Map();
function _zip(map,ls){
  for(const[cat,fams]of Object.entries(map)){
    for(const[fam,types]of Object.entries(fams)){
      for(const[type,particles]of Object.entries(types)){
        if(Array.isArray(particles)){for(const p of particles)if(typeof p==='string')_set(p,ls,cat,fam,type);}
        else if(typeof particles==='object'){for(const[subType,subParticles]of Object.entries(particles)){for(const p of subParticles)if(typeof p==='string')_set(p,ls,cat,fam,subType);}}
      }
    }
  }
}
function _set(p,ls,cat,fam,type){
  const ex=_particleToClass.get(p);
  if(ex)_particleToClass.set(p,{ls:'BOTH',category:ex.category||cat,family:ex.family||fam,type:ex.type||type});
  else _particleToClass.set(p,{ls,category:cat,family:fam,type});
}
_zip(LSE_Map,'E'); _zip(LSN_Map,'N');

/* ── Templates ── */
export const Templates={
  'msp-01':{id:'msp-01',seq:['v'],parser:'head-only',head:{slot:'pe',relation:'sentence',root:{slot:'V',posFamily:'verb',pos:'main-verb'}},tail:{status:'reject'}},
  'msp-02':{id:'msp-02',seq:['n'],parser:'tail-only',head:null,tail:{slot:'N',relation:'sentence',posFamily:'noun',unit:'word',must:'end_with_punctuation'},st:'c'},
  'msp-03':{id:'msp-03',seq:['n','v'],parser:'head-primary',inherit:['msp-01'],head:{slot:'pe',relation:'sentence',root:{slot:'V',posFamily:'verb',pos:'main-verb',children:[{slot:'N1',posFamily:'noun',relation:'unit',role:{type:'marker'},pe:'optional'}]}},tail:{status:'reject'}},
  'msp-04':{id:'msp-04',seq:['n','v'],parser:'head-primary',inherit:['msp-01','msp-03'],head:{slot:'pe',relation:'sentence',root:{slot:'V',posFamily:'verb',pos:'main-verb',children:[{slot:'N1',posFamily:'noun',relation:'unit',role:{type:'marker'},must:'has_locative_particle',pe:'optional'}]}},tail:{status:'reject'},special:{pattern:'WH + {noun_omission} + LOC + V + PT',st:'Qwh'}},
  'msp-05':{id:'msp-05',seq:['n','pt'],parser:'tail-only',head:null,tail:{slot:'N',relation:'sentence',posFamily:'noun',unit:'word',class:'noun-group-sequence',pe:{slot:'pe',relation:'sentence',class:'ending',must:'end_with_သာတည်း_တည်း'}},st:'c'},
  'msp-06':{id:'msp-06',seq:['n','v'],parser:'head-primary',head:{slot:'pe',relation:'sentence',st:'c',root:{slot:'V',posFamily:'verb',pos:'main-verb',children:[{slot:'pe1',type:'wibat',class:'subject-marker',relation:'unit',child:{slot:'N1',posFamily:'noun',relation:'unit',role:{type:'self'}},next:{slot:'pe2',type:'wibat',class:'source',relation:'unit',child:{slot:'N2',posFamily:'noun',relation:'unit',role:{type:'self'}},next:{slot:'pe3',type:'wibat',class:'goal',relation:'unit',child:{slot:'N3',posFamily:'noun',relation:'unit',role:{type:'self'}},next:{slot:'pe4',type:'wibat',class:'instrument',relation:'unit',child:{slot:'N4',posFamily:'noun',relation:'unit',role:{type:'self'}},next:{slot:'pe5',type:'wibat',class:'comitative|temporal',relation:'unit',child:{slot:'N5',posFamily:'noun',relation:'unit',role:{type:'self'}}}}}}}},tail:{status:'reject'}},
  'msp-07':{id:'msp-07',seq:['n','n','v'],parser:'head-primary',inherit:['msp-06'],head:{slot:'pe',relation:'sentence',st:'c',root:{slot:'V',posFamily:'verb',pos:'main-verb',children:[{slot:'pe1',type:'wibat',class:'subject-marker',relation:'unit',child:{slot:'N1',posFamily:'noun',relation:'unit',role:{type:'self'}},next:{slot:'pe2',type:'wibat',class:'source|goal|instrument',relation:'unit',child:{slot:'N2',posFamily:'noun',relation:'unit',role:{type:'self'}},next:{slot:'pe3',type:'wibat',relation:'unit',child:{slot:'N3',posFamily:'noun',relation:'unit',role:{type:'self'}},next:{slot:'pe4',type:'wibat',relation:'unit',child:{slot:'N4',posFamily:'noun',relation:'unit',role:{type:'self'},topic:true}}}}}},tail:{status:'reject'},frontedRule:'outermost_N_is_TOPIC'}
};
