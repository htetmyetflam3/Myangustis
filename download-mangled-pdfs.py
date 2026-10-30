#!/usr/bin/env python3
"""Download the books in mangled-pdf-names.txt from the scraper VPS.

SSH settings come from your existing .env: SSH_HOST, SSH_USER, SSH_PORT,
SSH_KEY and SSH_DIR. The current directory's .env is used by default; point
--env to it if it is elsewhere. Process environment variables and explicit
command-line options override file values, as in the scraper configuration.

Examples:
  python3 download-mangled-pdfs.py --env /path/to/.env
  python3 download-mangled-pdfs.py --env /path/to/.env --book=1704101675047
  python3 download-mangled-pdfs.py --env /path/to/.env --limit 10
  python3 download-mangled-pdfs.py --env /path/to/.env --offset 10 --limit 10
  python3 download-mangled-pdfs.py --env /path/to/.env --sizes-only
  python3 download-mangled-pdfs.py --env /path/to/.env --search-by-hash
  python3 download-mangled-pdfs.py --env /path/to/.env --ledger /path/to/uploaded-host.txt
  python3 download-mangled-pdfs.py --env /path/to/.env --all --limit 30
  python3 download-mangled-pdfs.py --dry-run

By default the curated selection in representative-pdf-names.txt is requested;
representative-pdf-types.txt explains the visible symptoms and limitations. Use
--limit or --book for smaller batches; --all explicitly selects the much larger
review index. Filenames append .pdf to dataset book names; original extension
case and the sizes of the original PDFs are not yet known.

The script searches SSH_DIR recursively. If names are missing or changed, an
uploader ledger can locate paths by hash, or --search-by-hash can read and hash
all remote PDFs under SSH_DIR without downloading them. The hash scan may take
considerable time and server I/O. --remote-dir overrides SSH_DIR for one run.

--sizes-only reports the byte sizes of located candidate paths without
transferring PDFs; those paths and sizes are not hash-verified by this check.
Every download is checked against the source PDF SHA-256. At most one file is
saved per selected book; existing files are never overwritten. The default
local directory is outside the repository. No files are added to Git, and
nothing on the VPS is modified. Review candidates are not confirmed errors.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

# Filled from the verified public dataset, not from font/keyboard guesses.
PDF_SHA256 = {
    "-1708528931770": "f9e1f34c38c180bd6b280436c916acf17f20941d89e8c1da6f4cec507d1a7292",
    "-1758614468061": "2a30c3a85ad1c4312382a226912b48e2c41178a9afd997f0149670eaff3673ec",
    "-1759341726906": "979daff6007030888c8f8646ab277ffac4e2b34ba682d8c32646d09300ee0faf",
    "1680800753958": "1c90df70f26d03bd2a808c2fbe445aa2b4db164e3c2a378017b3b7d40db1fd0c",
    "1681716042142": "83ea2d8bdf45859cc3e6e48a1626a3e226932472dfb6e6fc2ae31655f3d5e827",
    "1681774700481": "cc54c33946db95c3fcb36969a09d243c87096f6b94c8e5524dc97a0eaf64153b",
    "1683082497742": "a301c7739318272df4fdf1e3c19e4d973f870b2f4244af55903e85882b38c840",
    "1683900729176": "c6047d09615927313c2abd2e758b6f2d92c07fa413891e770b0879b599a1af03",
    "1683988423841": "ce65f479137c2ce5f0a5d932ac0c59697834972509892ad68361e3bd41c9c733",
    "1686651510593": "2c3a7f9724906a3505de9a8b174d70efa39700ca83418f4f4d585caed1b1d9d0",
    "1687772069622": "6ffd1971d457dfc61df8dc6af12f49c08efdbec54e2b8292f55c8a8151920552",
    "1689564403074": "c72e5d5b30ce092b4cbf9269eeb065038ad3c4cda7ef9eb2d6621a32141a20bb",
    "1689959710117": "49a94a490cbd276b03af7ed48db25ffeb0b09855c513b52b742b92934984c442",
    "1690911230429": "2a693d7d1013d37a6e9ad0766d576fd441c25b9efd3e3c1b75190d95acd9ac15",
    "1691340688985": "544df179b17d24d66576b23ba84ce92ed7ec0da5279ed59c1c54771c3588eef2",
    "1691448988172": "5570b7f647ac4f5c8c9129ba4573a93d169ca2cd2b69c813237ec68a9d395d4c",
    "1692171082250": "4d6733b1094e7da6faf82aaf216fda6972a4d2c2e86ac434cad5b4faef54b50a",
    "1693064173472": "52fd6d97651bcedc4e88ccf18785ffa0fd54d38f97cca6b3cd0020206835ab4c",
    "1693107457569": "c7c6f007a90a544c683ec3f9725f8fa8e801bec1ec23137bbc20bafe161b67f5",
    "1693245630110": "853d9c207e8e1403e1bc2c5ac319ccf74cc8f520f6da675a1610dabbea108c86",
    "1693544137113": "cf1415b8d73f9ca7b90b933e260e9a901a5186cf1764f1ba230f9a3663d5816f",
    "1693904077870": "3ad5c61f0547a392207613258cc6a9443e74a012263f9b8ff6133fe9b3facc19",
    "1693914057531": "252e25415260df0d337aa523c8b9bc0d3201fd1239368b6fabbffaf2715c6904",
    "1694508363864": "4da677a8da3c247bb1a3e535c3afead9a726d07c196ae1a1f76d7d11b4d359ca",
    "1697083096373": "f95dbe30f2cca3ec4a857bbc65c3464e6efa80ff3b150e058c81558c6b2aa576",
    "1698055104078": "b558dc3e6e27146076c5231a897cdce270185ad5cc39dd3fd026318187121991",
    "1699176399227": "f00590f1203cb695702ae49d4d110f1747efe91d388f1877a14f20b7c043a3b8",
    "1702644363071": "7d8d130e432c0c87b1b733be47b265bc0568b792624e6edf401a6ef523abe18a",
    "1702826768136": "b6e454e263e0214b2811220be91ed568dc08d1fdd14a55e4f12c3079382717ab",
    "1702975118935": "167771967b783b6fb55142c47f73ef4b174f5ebd542276378499474ef3d72044",
    "1703270109879": "1a4387d0e45eae2c2ca8e06768b64a35010f842cc6289fa45e3eac17e45d4fbf",
    "1703521227806": "851e314ed72049984182d6d95b1b95972daa74acb1c7b8f107c092d5bb6736ec",
    "1703524837273": "903db33bbaa5d410383d544ef03d9d0adf2cbb7eaa420e4af7e7cf113fdbd196",
    "1704101675047": "996c78a372e1bcd0ab27eb8e3b619c51216c00c84e1937ae0a4a1511b2b7cd43",
    "1705152502270": "0ed4f55a509ae508cc0b9ff511edf7425fb475bc34a3e2f9e3cdbc3ee67bfdfa",
    "1706036024958": "3888a57258e62e92c111ae19702e35f4ab63372bce3f27eb19c52feae56794a1",
    "1706085249444": "89800d6c2e5af45d2e71f41844a532aa2d8056c69a83041175eb02fd568a373a",
    "1706115383096": "be8720d17999e4f5e590c17ee2f87371ce5018085d9543f1b68617bea9e8f0ec",
    "1706118210298": "10f7b1fa18deef62d4060e09b34229663b7e5aeaba1177533933d2b37abc3dbe",
    "1706118384028": "54b6fb22e14c1fb89011e7603c0ab4afa3feecb54640c83e525005b26664d282",
    "1706118392082": "53a6a711a4ab30fdc5bf800d274f40b70acc4d5070135eaba6ca32a7f99b3b68",
    "1706119140545": "83b1ee5e6f01068ca5deab7e9b2ea78a817bab84489fd80d56142da2401d2f66",
    "1706119141337": "c71400fc897dcecbe8113a88bc27d2661545f8e5467b1e71a58c9a7e75d7e83b",
    "1706119156858": "3d0541ad300de483300692241fb9e8bf75a6b4131ac3b673ef3db91b4273516b",
    "1706176961593": "58a98abe48049bfc99f33742f745e7507a692ed235d2081bb3279cf9ed3a8571",
    "1706300888234": "7becbb64de7b47145158d808f5498053e653e4f5aa823a3560ee429c4207dbd0",
    "1706301383341": "86768933e3a41698946f357be91739e5c2cec10fe53b6198b05dd9c756056015",
    "1706302190221": "80a28041b27a5db83fac17ef11a8cf1d664c8a8083d255d258facc7a6cb5f082",
    "1706302438993": "e9f7def275cb0a30617b799a177e640392acbf433881332829de00dbeb3f9e45",
    "1706302441939": "e9827e3033a8d2ddf508215201ff37e3a38d428ff7b449656d18c0b20eac0b86",
    "1706302445830": "8185ac69fc797da4fb5ac1177efdc9c3d5e97bc345123b13a01c30c02e2a8098",
    "1706302446480": "172bd76a7a77f8bf6cbc7557854fe219400b1e5f854a52a603953edaf06ef019",
    "1706302447717": "3b23491cd6741c3c53095afd0b9922b32e06e763280e3f44570a9099e734886f",
    "1706302600730": "56fb01da8f89933c36a808b04b385175e6394dee4b661c9a5588e64449963616",
    "1706302745930": "a42e128cc3259a27dca667cca15be9f6162deadf9b7537661ed5fb2b933a62a0",
    "1706303227693": "19f37dd791f5608449584351a8a364909e75a6a6eaa66cf5b3b97d4da912d5c4",
    "1706303228990": "090bc51e5871d3188ba8d0876f5431ab51e77f0d35dc04a7d02382f09c1cea52",
    "1706303571424": "895c872e9f7f725e52347eb03ffe920d7a6806deb378c5d4c4fc55908ad5f1b8",
    "1706303575223": "d10b7f76bd5ddb1c4f4637e7cd3fc613bec2faa64cc2c6c68cd30bac22d7a150",
    "1706308534942": "fb94a350cfc7ea593b4755afe05825484cd676cb9dcee0bedbeb8107c5fe78ca",
    "1706494294594": "8b7a2b8daa3f1e370a77ee137d92d0441284cc9bd36cd90db5c4c99c9d3d398d",
    "1707195104410": "fcd07393aac07b0eeb23993528354d259459b002daedee14b36faafe031d8f5e",
    "1707365284222": "ee4da8fe5a64b2b9c233f2d52a9e90602365d5bf3e5d446165fbdd7bb0349c79",
    "1707666661680": "023d001e2aadd106b889babf73dec3d3b4c1a3d66d68622cda7637ecdff3543b",
    "1707666773664": "a74cff9e4c1d423663b7579d58b18211c6d26059307d5deb2e2b4e472d67701a",
    "1708961902669": "8371a6d6a6a6bf10489ca7fb780dc74cd9b84a41d1202e54475700c8e3b5db5a",
    "1712821408320": "46a083b83ee6d17f511b5b044ed967c716e7e7143dc113982dacfa1b4f7090b7",
    "1714041032569": "b666e484a3f09470b7e43949ba51e1916bcff5134a77650e9dc55f85f0614f4f",
    "1716336222602": "798495aab8de16c968ece5bcbee34ccb9aa201d10595cf638371e2d480f502c7",
    "1758614515798": "90937b06182349f83215b6f4c86497fff0cc567ad11d422fe141db177dd4460e",
    "1758614531892": "f0a867d60d6fd5420a0ab8018dff8bd6cb57fdc53b4826297a67de80e4a0cf50",
    "1758614595970": "3135ddaffeaa8b08872e1fb0e2bd1a39a6a7da67108c77666bf4cb5030170f68",
    "1758614665514": "af44bb6e505a0873d205a42e46560029f479c8bef012f010ff51880095da35c9",
    "1758620453187": "6889e38f449b050bafa96f9a347009d3846ac01c18b823377c6f95c7292748b4",
    "1758701152750": "5b86257ccfa857e55c7af6a671fa716514ebbd28fbf2236f3ba509bb8fe020c0",
    "1758724351533": "035769972042db727f9767441b761757e37208b4fea35c9396478db7780d6547",
    "1758980418795": "84266fb92b23582d793e244ddca76608b9aea2c91b33d9b81073ed29541e244f",
    "1758980446382": "a544cf89ef351b988dc0c5442f3619ef31434a670633cfedc4bd8bced78cda86",
    "1758987502476": "11d0c9d856ad020c529d6a58c0228f2b957dcf3eeb6b5f3dd563a067a52826a2",
    "1759199573598": "d07838b7f5f228680430fd80beefabffc9342e156a3ee73af232574731486637",
    "1759264676234": "882b8a62887162879ff07ec9a9caa55b54b047e5e59ab7f4c9d14ae6489f72f6",
    "1759388334644": "7eff08278b24ce86308163b26909fb435feca9a34df0aff5b9f1145d8ecdc045",
    "1759598726360": "f949c27bb3addf0fdd0fe1f1fd1f4d804baeb465b914f002ec9241bb6d6fd140",
    "1759845684572": "382c058a0b1589f85f256da6bc38dfd7966658660328a97cbbf618f70183d487",
    "1761410353665": "fc03ac451b1ecfa18384c856c3410883322a7a9e2887dbef534127b87a89db05",
    "1761689865836": "ac8f11673538fb7c1256f1bffd3f34ecd36004ee527f270a5ccbdc1bba0cdc10",
    "1765481030976": "dabb4527cafa3562daa9432461c56f8b4bbcdb7be397efb3a4764c19d2f9061b",
    "1773705881963": "9625383d833af522aec0ecd1e8617c19f5f465d4288253dcc0bc49be35ae1746",
    "1774769195137": "9b9abc5ab1c84bc5e5b868eecf4e4c5c5b9f30f82c84150993e9f0299c653e1b",
    "1775189898005": "1629bc0a5ec8c71478ff59ad92d6743058180f6de849875215f145dfa2c48885",
    "1783948012042": "602840d11c2ead4054cf00338933cc48bbd5f5018ce87d1ea9cc792d7789af60",
    "1783952099463": "39bf26f9ecf4bd60060b1a0c3b2529acd45d05fed0c82aea695077e98cb71b9d",
    "1784274916692": "20c7a6a0e3ea3063f87d1b55d9a7d6ac68e40181da3e6b8a773fbaa3bad9decd",
    "1784999368188": "c92f8ec930cb6837037443dc2542bf18f46d40bb1225844262d012b72811ccfa",
    "1785548016136": "204421f11a613b0c61b91839d5625d13fe42a33624b5b31c99128b62a83d5069",
    "1785589730113": "e3dad51edb2daf00a8db781d0b91a86c781b95a0b264052b5be32e57d67f08a1",
    "1785661897658": "b6336154d19f7292dd8c5bfe49ccd87103aeed8eadb7927428a08b6c1e5ab815",
    "1785685700221": "8131420fb798f3e8965dc19170d4c7f07528259c37857c15cfab26a415a8b131",
    "1786504776280": "6762586577af66834a1ca9f053195cacd809f74c348a242bf47a38a97aeede2b",
    "1788764739831": "0abc861e7198d2184e3965540f070bdc7abb3aaa670a0884e09137cc3608b1b0",
    "1789180271132": "14048125c51b96351bc67da1efb8a15e3701c5f3bb3918eeff4fc1d29dbbf704",
    "1789702727965": "e3dd911beba97bfe30022ffc2a0dfaf86aca1548b9663d3639a0c6484ab16f1f",
    "1791560434154": "089d78547b4e8afd9739933c1bb85b8e8b1a828833dc6d80e28f61cf515fb0fc",
    "1792041524361": "50ec584aa42586f5306bd1e109ac960e9aa863a256a0fd28422390965f9328e7",
    "1792042706358": "4a5a56409fa16f77b69b0f8a9e9211ad6c05795386427eb6b4434b51c2a65ad0",
    "1792325291870": "eb6af77933315c3b6e06dc2823a061052ef93405b5d6ef11008a399579639f69",
    "1792388014179": "7c0ba6321b6d840610acc3a3771c76c4dd9bed6e9bf6067014a8f9b57b0e0eed",
    "36-short-stories-of-jue-1708877870919": "b8b18d260cd2802332a964260db22686d9ce4a86d838f769137a91d1efd2c84d",
    "a-coat-1680281236656": "ee94fe10d4d66269c87864dd9a65c13f071017fcc9b456067f19f72aebe58f40",
    "a-portrait-outline-of-sai-hte-sai-1759432455621": "e49c2257c0f516e4626ceb7b63bc0db8eb1325bcd97525d1fda5480c9f57866d",
    "anawrahta-the-founder-of-the-bagan-empire-1783991149510": "d6f60429d99d4b554da68b110ac0d486a6fa24bdcd8e4fcffd401892e69cdf77",
    "android-mobile-repair-guide-1680791177349": "ac4a264beeaa8c92763dce8d6cc9744a05b5964fa500b7e961a087bf358b260a",
    "animal-cycle-1784260642033": "efc0cd81f8d0a7a20df9dd70efe604f2a44e3767bcd0f2563b443325a2c40a10",
    "antivirus-book-1706454614822": "552809c8669c1c11c803afaa923bc81e85fcb09a28a030a4030606f74e1e450b",
    "applied-hvac-system-in-marine-offshore-1703603560839": "145a9800168def71eeffd0cd649fa624509b6eac578af5f9e81594cf865dfb07",
    "at-away-1681716501732": "01dcdc879c6c0aa8613d5b771706c337a754ae1b5b51ff1b6b11de5f87ff69b0",
    "best-theory-of-physical-education-1693147797764": "b829b7791baff78020ccfe3093a5fbd2f46f85672b2181a08e57c66d194502b1",
    "bob-priest-world-top-comedy-short-stories-1706312521763": "025465aa716b368842cb4c1085db41d3b26f483c1e7875b831b0bfa352aa2b07",
    "chillers-and-chilled-water-systems-1785673326897": "b55416c65067c0b6f337d5ea370346e4a671dd4c0eef45c063e6a60e610cb54a",
    "chinese-stories-2-1705316817328": "87d96bf2559f38f9e17d0478d4f6cb80fd5c757be7df84cabac8cf80768bd47c",
    "chinese-stories-part-1-1705317289776": "8a90c838a0e3d7ae5174b34df7f18e5c0ab7434e4fb176e42380bc45a36940ff",
    "chinese-stories-part-3-4-1705386897174": "72ff88fca9353b299eae834fa89d9322a98810141ab1598f0af869171d915cac",
    "city-poems-1706870169476": "0dfb86575e4ad22604bdc1733570b3bce3a17700b1f4ccb8870a08331f9ba510",
    "contemporary-bridal-short-stories-1785225727606": "b2dda84d457c125e09de906d02eb64678d267a63f3b336d7d131c2036d2d67c2",
    "curiosity-science-magazine-year-1-issue-1-1760318923964": "43b2024b73a4d5b734cb89f1e757b1c3369d4932dd7e8d8f409a80815d29e252",
    "curiosity-science-magazine-year-1-issue-3-1691666171451": "4f1316ad7f8b2698721646fdd9287789a2689a48cf9c29396fba918e78108404",
    "curiosity-science-magazine-year-1-issue-7-1787061931055": "e62158933d3eec51c065368fe0783aefae9f14bf878bda823d476c8b01fea6b8",
    "curiosity-science-magazine-year-1-issue-9-1696435525386": "d75b9ae2cd4b4f2f46391f70ddcaf514b6c108744a24ff369a0f1e187389ddef",
    "curiosity-science-magazine-year-2-issue-2-1696435557299": "a77c4e81c6465a033467d527c50552dbe53ba29d5fa07ff31dbb8b10a9cdfc12",
    "curiosity-science-magazine-year-2-issue-3-1696435577934": "7b37d529553d07280e1b083be17fba00554bb41643e58d8d3eb044fabbc21ad2",
    "curiosity-science-magazine-year-2-issue-4-1696435591836": "958d3844ca63a1f06eb17173ebe60760777ae48eae181ec74e22fb6dd87ab469",
    "dhamma-satkyar-1696943133253": "1f41b9d0a2baad5b841b9c3c068b9c8b049cc056cea2a574156ff5d7890fd680",
    "family-handbook-1706101731370": "a1ad13a6169ed98b974556e40da37fb382c08178c561ac07b835408f7b2ecfb3",
    "fear-and-your-life-1760260200746": "aaac05609518858573d8a047a905473079430e58713e9a6cd7e1877f3e5c6ea2",
    "focus-youth-magazine-1706129290509": "ee6a05680d24deceb665bd40823aae9c1293aabcf347935066c5b4177b3360fb",
    "h1-n1-1688180802659": "bda5a6ba9487170f4b4b276cf58b3005c2899b374fb7693ad067286a15a3cac2",
    "h1-n1-1716537335159": "f70065d5f86e612e2f3ec39eda3f32822c52a91f8499cf55ad088221127dea24",
    "hacker-handbook-1790571086574": "d68b851baec2dd61c298e6b791611d5ed68711b00c3a2f1023e826e0cf723256",
    "harddisk-issues-1791994279395": "75460111d5c60bb4ac73ed8d24d4660478fcccb2fb02388fc15fe6457841429d",
    "-1693248588542": "21fb40aa6e9a07dc2a6927466d6cbdd5c7916a914cabe80548cb293d730acc7b",
    "heads-of-japan-1785609388123": "899d526e48eaf6c504632f9ad808dbcf2fda6bd35a30d84e8835562f540dfb15",
    "-1706804477315": "547849b879467dfee7ad6b9a3f10156c21b86671044d1a785e51eefd0e63c8f7",
    "heartache-1691950053296": "6fd9600b38768240eef4998c22bdb0ca515514a78942279d40965af14cc9ecd2",
    "heartbeat-1786762037941": "f7b2d9f0f984e93aa5fa5f7cfc39dfdfa9c25952b57dd478e7e0f7ca7e20c350",
    "his-famous-novels-with-a-brandy-1706018918977": "a1ab1bbae04af952b58d289ec9e3ecea447582377822086cf632838f25d6c34c",
    "ho-chi-minh-1707836407447": "5dc31c0980dc242d70ecd27defc9a8a5f43254ba4d618259d809b1ed3bee630d",
    "-1706804720694": "527116258fa7937a1b3a6ae16e27f0cbc41c317c70c25d5945d8ff828ee6cd65",
    "-1706804835850": "20e1a7a7fbbcbd1a591e350520f809f935a7c447db2de539b74f60f5c1879ae2",
    "-1707218535397": "3413b2b23db159c85370e4797095ec472ab4dc86a93d0cb1246213289d5e1c2e",
    "-1710135911863": "b97e969b382ae672f3820beedf631728659e22d10a9800aa83726cfeec5b537c",
    "-1716189358461": "6aa9053ac23781f569e601a967e3f301cd55b9d659f238b9bddd0ee6a9d819a5",
    "-1758614263766": "b195590c6c22fe37f69eae370f589c0e49842b6364cba82393094c323ed154e8",
    "-1758614352663": "cf9477ecfd358982d7e33d2eb21e2e0a62c7f1d1c986a3995e488531e0d7827f",
    "-1758614480066": "b8676c0c5cde7f3f44ccb50b2d433cb68d0af97d913ded2f642011ec7af7ff27",
    "-1758699987420": "a8d00a63cadd6c9f1e6f54c75e4d36bae3486d8b42ac8e8db814f1acddc588ab",
    "-1775392889629": "a671297f620387adea9322dcfc3f640b95154393f15c89c70178e1fb54c3a1d6",
    "-1781488989861": "6be3d233d5daff4a481c08ad7950e188e0781d7467119bfda324b60a0227b9e7",
    "-1784554562929": "d1048d3b121a829e6881ae558c3d65ec6c7ab7687d1ac6e59abcdac601bcb42e",
    "-1786385765052": "b43231ab5014068e6b3dbf921745ba1d1d148bb735177549690fe971d5380afb",
    "-1791893590189": "9ae604dcdd859c353789cedf5c32c4f7234b6191e9a3572470065df44adf26b4",
    "1-by-4-4-in-1-1785335697045": "f2cd541c3dd27713541d4f5b5d0df3f62c221d1ae64951f6878ebe369d969078",
    "10-jataka-stories-1704619021023": "5a5869b8bbf9c5522f1fd1240c7eec521c4ca0a57b50b2e78862a265361ad3a8",
    "100-good-ways-to-be-successful-and-grow-1702298897509": "dbe2247bb5baa5e4fa8bdd6fda9f01ec550143e1d1f122c4b84cdd35c4fc8182",
    "100-loves-of-my-sweetheart-1785692723787": "37a9034a8808c416fd31af26cda2238c4ddb778f3909d132311caaf96dd88c9c",
    "100-short-stories-1783992392966": "d27c8ae38329d0b164b2e82bb1c02173b7025e6c28610e7e63c1e68218225c48",
    "100-ways-to-be-happy-and-rich-1689657291094": "747e387c2d8f16313b8c4b559a54507d3da61206c639a46a894e08258627d226",
    "100-years-of-general-aung-san-100-letters-1758627755471": "4d4ca3dde9d56eb13be1f1b44f3142654eb98465a5d9ff616ddc6416492be217",
}

DEFAULT_LIST = Path(__file__).resolve().with_name("mangled-pdf-names.txt")
DEFAULT_REPRESENTATIVE_LIST = Path(__file__).resolve().with_name("representative-pdf-names.txt")
DEFAULT_DEST = Path.home() / "mangled-pdf-downloads"


class DownloadError(Exception):
    pass


@dataclass(frozen=True)
class SSHConfig:
    host: str
    user: str
    port: int
    key: Path | None
    directory: str


def env_values(path: Path, *, required: bool) -> dict[str, str]:
    """Read only SSH settings; never print or persist the file contents."""
    try:
        lines = path.expanduser().read_text(encoding="utf-8-sig").splitlines()
    except FileNotFoundError:
        if required:
            raise DownloadError(f"Environment file not found: {path}") from None
        return {}
    values: dict[str, str] = {}
    for number, line in enumerate(lines, 1):
        entry = line.strip()
        if entry.startswith("export "):
            entry = entry[7:].lstrip()
        if not entry or entry.startswith("#") or "=" not in entry:
            continue
        name, value = entry.split("=", 1)
        name = name.strip()
        if name not in {"SSH_HOST", "SSH_USER", "SSH_PORT", "SSH_KEY", "SSH_DIR"}:
            continue
        value = value.strip()
        if value[:1] in ('"', "'"):
            closing = value.find(value[0], 1)
            if closing < 0:
                raise DownloadError(f"Unterminated quoted {name} in {path} at line {number}")
            value = value[1:closing]
        else:
            value = value.split("#", 1)[0].strip()
        values[name] = value
    return values


def load_config(args: argparse.Namespace) -> SSHConfig:
    path = args.env if args.env is not None else Path(".env")
    values = env_values(path, required=args.env is not None)

    def setting(name: str, override: str | None = None, default: str = "") -> str:
        if override is not None:
            return override.strip()
        return os.environ.get(name, "").strip() or values.get(name, "").strip() or default

    host = setting("SSH_HOST", args.host)
    user = setting("SSH_USER", args.user)
    directory = setting("SSH_DIR", args.remote_dir)
    if not host or not user or not directory:
        raise DownloadError(f"Set SSH_HOST, SSH_USER and SSH_DIR in {path} or the environment")
    if any(item.startswith("-") or any(ch.isspace() or ch == "\x00" for ch in item)
           for item in (host, user)):
        raise DownloadError("SSH_HOST and SSH_USER must be single valid SSH arguments")
    if any(ch in directory for ch in "\x00\r\n"):
        raise DownloadError("SSH_DIR contains invalid characters")
    try:
        port = int(setting("SSH_PORT", args.port, "22"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise DownloadError("SSH_PORT must be a number from 1 to 65535") from None
    key = setting("SSH_KEY", args.key)
    return SSHConfig(host, user, port, Path(key).expanduser() if key else None, directory)


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def names_from(path: Path) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for number, filename in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not filename:
            continue
        if (filename.strip() != filename or any(ch in filename for ch in "/\\\x00")
                or not filename.lower().endswith(".pdf")):
            raise DownloadError(f"Unsafe or non-PDF filename on line {number}: {filename!r}")
        name = filename[:-4]
        if name in ("", ".", "..") or name not in PDF_SHA256:
            raise DownloadError(f"No recorded PDF hash for {filename!r}; refusing an unverified download")
        if name not in seen:
            names.append(name)
            seen.add(name)
    if not names:
        raise DownloadError(f"No book names found in {path}")
    return names


def ssh_args(config: SSHConfig, command: str) -> list[str]:
    # Follow vps.py's non-interactive SSH behavior without changing host-key checks.
    argv = [
        "ssh", "-p", str(config.port), "-o", "BatchMode=yes", "-o", "ConnectTimeout=20",
        "-o", "ServerAliveInterval=30", "-l", config.user,
    ]
    if config.key:
        argv.extend(["-i", str(config.key), "-o", "IdentitiesOnly=yes"])
    return [*argv, config.host, command]


def ssh(config: SSHConfig, command: str, stdout=subprocess.PIPE) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(ssh_args(config, command), stdout=stdout, stderr=subprocess.PIPE, check=False)
    except FileNotFoundError as error:
        raise DownloadError("ssh not found; install an OpenSSH client") from error


def failure(result: subprocess.CompletedProcess) -> str:
    stderr = (result.stderr or b"").decode("utf-8", "replace").strip().splitlines()
    return stderr[-1] if stderr else f"ssh exit {result.returncode}"


def home_directory(config: SSHConfig) -> str:
    if config.key and not config.key.is_file():
        raise DownloadError(f"SSH key file not found: {config.key}")
    result = ssh(config, 'printf "%s" "$HOME"')
    if result.returncode:
        raise DownloadError(f"Cannot connect to SSH_HOST: {failure(result)}")
    home = os.fsdecode(result.stdout).strip()
    if not home.startswith("/") or "\n" in home:
        raise DownloadError("The VPS did not return a usable absolute home directory")
    return home


def remote_path(raw: str, home: str) -> str:
    # Same home-relative and ~ handling as vps.py; quote the result for ssh.
    path = raw.strip()
    if path.startswith("~"):
        path = path[1:].lstrip("/")
    if path.startswith("/"):
        return path
    return f"{home.rstrip('/')}/{path}" if path else home


def ledger_paths(path: Path, selected: list[str], home: str) -> dict[str, list[str]]:
    hashes: dict[str, list[str]] = defaultdict(list)
    for line in path.read_text(encoding="utf-8").splitlines():
        fields = line.split("\t")
        if len(fields) >= 4 and fields[2]:
            remote = remote_path(fields[2], home)
            digest = fields[0].lower()
            if remote not in hashes[digest]:
                hashes[digest].append(remote)
    return {name: hashes[PDF_SHA256[name]] for name in selected}


def discover_paths(config: SSHConfig, directory: str, selected: list[str]) -> dict[str, list[str]]:
    # NUL delimiters keep spaces and non-ASCII filenames intact. `find` is
    # read-only and does not follow symlinked directories.
    command = f"find {shlex.quote(directory)} -type f -iname '*.pdf' -print0"
    result = ssh(config, command)
    if result.returncode:
        raise DownloadError(f"Cannot search SSH_DIR on the VPS: {failure(result)}")
    wanted = set(selected)
    found: dict[str, list[str]] = defaultdict(list)
    pdf_count = 0
    for raw in result.stdout.split(b"\x00"):
        if not raw:
            continue
        path = os.fsdecode(raw)
        leaf = path.rsplit("/", 1)[-1]
        if not leaf.lower().endswith(".pdf"):
            continue
        pdf_count += 1
        if leaf[:-4] in wanted:
            found[leaf[:-4]].append(path)
    matches = sum(bool(found[name]) for name in selected)
    print(f"Found {pdf_count} PDF files under SSH_DIR; {matches}/{len(selected)} selected names matched.", flush=True)
    if matches < len(selected):
        print("Some names were not found. Check SSH_DIR, use --ledger, or try --search-by-hash "
              "for renamed originals (reads all remote PDFs).", file=sys.stderr)
    return {name: sorted(set(found[name])) for name in selected}


def discover_hash_paths(config: SSHConfig, directory: str, selected: list[str]) -> dict[str, list[str]]:
    # This scans server-side bytes but transfers only checksums and paths. The
    # NUL-delimited GNU sha256sum format preserves spaces and newlines in names.
    print("Hashing PDFs under SSH_DIR to find renamed originals; this may take time and disk I/O.", flush=True)
    command = f"find {shlex.quote(directory)} -type f -iname '*.pdf' -exec sha256sum -z -- {{}} +"
    result = ssh(config, command)
    if result.returncode:
        raise DownloadError(f"Cannot hash remote PDFs (requires sha256sum -z): {failure(result)}")
    by_hash: dict[str, list[str]] = defaultdict(list)
    for name in selected:
        by_hash[PDF_SHA256[name]].append(name)
    found: dict[str, list[str]] = defaultdict(list)
    for record in result.stdout.split(b"\x00"):
        if not record:
            continue
        if len(record) < 67 or record[64:66] not in (b"  ", b" *"):
            raise DownloadError("Unexpected remote sha256sum output; use an uploader ledger instead")
        try:
            digest = record[:64].decode("ascii").lower()
        except UnicodeDecodeError:
            raise DownloadError("Unexpected remote sha256sum output; use an uploader ledger instead") from None
        if digest in by_hash:
            path = os.fsdecode(record[66:])
            for name in by_hash[digest]:
                found[name].append(path)
    matches = sum(bool(found[name]) for name in selected)
    print(f"Remote hash scan matched {matches}/{len(selected)} selected PDF hashes.", flush=True)
    return {name: sorted(set(found[name])) for name in selected}


def report_candidate_sizes(config: SSHConfig, names: list[str], paths: dict[str, list[str]]) -> int:
    """Read sizes only; a same-named path is not necessarily the requested PDF."""
    failures = 0
    single_sizes: list[int] = []
    for name in names:
        candidates = paths[name]
        if not candidates:
            print(f"NOT LOCATED by this search: {name}", file=sys.stderr)
            failures += 1
            continue
        sizes = []
        for path in candidates:
            result = ssh(config, f"wc -c < {shlex.quote(path)}")
            if result.returncode:
                print(f"ERROR checking size of {path!r}: {failure(result)}", file=sys.stderr)
                continue
            try:
                size = int(result.stdout.strip())
                if size < 0:
                    raise ValueError
            except ValueError:
                print(f"ERROR invalid size returned for {path!r}", file=sys.stderr)
                continue
            sizes.append(size)
            print(f"{name}\t{size} bytes\t{path!r}")
        if not sizes:
            failures += 1
        elif len(candidates) == 1 and len(sizes) == 1:
            single_sizes.append(sizes[0])
    if len(single_sizes) == len(names):
        print(f"Provisional total of one candidate per book: {sum(single_sizes)} bytes.")
    else:
        print("No total: some books have missing, unreadable or multiple candidate paths.")
    print("Candidate paths and sizes are not verified by this check; no PDFs downloaded.")
    return 1 if failures else 0


def install_without_overwrite(temp: Path, target: Path) -> None:
    """Publish a verified temp file with exclusive creation, even under races."""
    try:
        os.link(temp, target)
        return
    except FileExistsError:
        raise
    except OSError:
        # A filesystem without hard-link support still gets exclusive creation.
        created = False
        try:
            with target.open("xb") as destination:
                created = True
                with temp.open("rb") as source:
                    shutil.copyfileobj(source, destination, length=1024 * 1024)
        except BaseException:
            if created:
                target.unlink(missing_ok=True)
            raise


def download_one(config: SSHConfig, name: str, candidates: list[str], dest: Path) -> bool:
    expected = PDF_SHA256[name]
    target = dest / f"{name}.pdf"
    if target.exists():
        if target.is_file() and digest_file(target) == expected:
            print(f"SKIP verified existing: {name}")
            return True
        print(f"ERROR existing file differs; not overwritten: {target}", file=sys.stderr)
        return False
    if not candidates:
        print(f"NOT LOCATED by this search: {name} (it may be renamed or outside SSH_DIR)", file=sys.stderr)
        return False
    dest.mkdir(parents=True, exist_ok=True)
    for remote in candidates:
        fd, temp_name = tempfile.mkstemp(prefix=".pdf-download-", suffix=".part", dir=dest)
        temp = Path(temp_name)
        try:
            with os.fdopen(fd, "wb") as output:
                result = ssh(config, f"cat -- {shlex.quote(remote)}", stdout=output)
            if result.returncode:
                print(f"ERROR reading {remote}: {failure(result)}", file=sys.stderr)
                continue
            actual = digest_file(temp)
            if actual != expected:
                print(f"HASH MISMATCH for {name}: expected {expected}, got {actual}; trying any other match", file=sys.stderr)
                continue
            try:
                install_without_overwrite(temp, target)
            except FileExistsError:
                if target.is_file() and digest_file(target) == expected:
                    print(f"SKIP concurrently created verified file: {name}")
                    return True
                print(f"ERROR file appeared during download; not overwritten: {target}", file=sys.stderr)
                return False
            print(f"OK {name}  {expected}  {target}")
            return True
        finally:
            temp.unlink(missing_ok=True)
    print(f"FAILED no matching PDF among located paths for {name}", file=sys.stderr)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", type=Path, default=DEFAULT_LIST, help="all review-candidate names (default: alongside script)")
    parser.add_argument("--representative-list", type=Path, default=DEFAULT_REPRESENTATIVE_LIST,
                        help="curated default selection (default: alongside script)")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST, help="local directory (default: ~/mangled-pdf-downloads)")
    parser.add_argument("--env", type=Path, help="path to existing .env (default: ./.env)")
    parser.add_argument("--remote-dir", help="override SSH_DIR from the environment/.env")
    parser.add_argument("--ledger", type=Path, help="local scraper uploaded-host.txt: find remote paths by PDF hash instead")
    parser.add_argument("--search-by-hash", action="store_true", help="hash every remote PDF to find renamed originals; may be slow")
    parser.add_argument("--host", help="override SSH_HOST from the environment/.env")
    parser.add_argument("--user", help="override SSH_USER from the environment/.env")
    parser.add_argument("--port", help="override SSH_PORT from the environment/.env")
    parser.add_argument("--key", help="override SSH_KEY from the environment/.env")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--representatives", action="store_true", help="select the curated examples (the default)")
    selection.add_argument("--all", action="store_true", help="select all review candidates, not just the curated examples")
    selection.add_argument("--book", action="append", help="select one book name or PDF filename; repeat (use --book=NAME)")
    parser.add_argument("--limit", type=int, help="maximum selected books to download in this run")
    parser.add_argument("--offset", type=int, default=0, help="skip this many selected books before applying --limit")
    preview = parser.add_mutually_exclusive_group()
    preview.add_argument("--dry-run", action="store_true", help="list selections and expected hashes without connecting")
    preview.add_argument("--sizes-only", action="store_true", help="show unverified remote candidate sizes without downloading")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be a positive number")
    if args.offset < 0:
        parser.error("--offset must be zero or greater")
    try:
        names = names_from(args.list)
        if not args.all:
            requested = names_from(args.representative_list) if not args.book else [
                item[:-4] if item.lower().endswith(".pdf") else item for item in args.book
            ]
            missing = [name for name in requested if name not in names]
            if missing:
                raise DownloadError(f"Requested names are not in {args.list}: {', '.join(missing)}")
            names = list(dict.fromkeys(requested))
        if args.offset >= len(names):
            raise DownloadError(f"--offset {args.offset} skips all {len(names)} selected books")
        names = names[args.offset:]
        if args.limit is not None:
            names = names[:args.limit]
        if args.dry_run:
            for name in names:
                print(f"{name}\t{PDF_SHA256[name]}")
            print(f"{len(names)} selected; dry run did not connect to the VPS.", file=sys.stderr)
            return 0
        config = load_config(args)
        home = home_directory(config)
        directory = remote_path(config.directory, home)
        if args.ledger:
            paths = ledger_paths(args.ledger, names, home)
            matches = sum(bool(paths[name]) for name in names)
            print(f"Ledger has paths for {matches}/{len(names)} selected hashes; remote availability is not yet verified.")
        else:
            paths = discover_paths(config, directory, names)
        if args.search_by_hash:
            hashed = discover_hash_paths(config, directory, names)
            paths = {name: list(dict.fromkeys(paths[name] + hashed[name])) for name in names}
        if args.sizes_only:
            return report_candidate_sizes(config, names, paths)
        failures = 0
        for index, name in enumerate(names, 1):
            print(f"[{index}/{len(names)}] {name}", flush=True)
            try:
                if not download_one(config, name, paths[name], args.dest):
                    failures += 1
            except OSError as error:
                failures += 1
                print(f"ERROR {name}: {error}", file=sys.stderr)
        print(f"Done: {len(names) - failures} verified, {failures} missing or failed; no remote files modified.")
        return 1 if failures else 0
    except (OSError, UnicodeError, DownloadError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
