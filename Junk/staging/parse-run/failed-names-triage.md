# Triaging the JS-failed books from the Python output

21 books have Python output in `Junk/parsed-books.txt`; 134 names are on the JS-failure list. Nothing was extracted from the parquet.

## Symptom counts

| syndrome | books | what it means |
| --- | --- | --- |
| ok | 8 | text looks readable |
| detached-marks | 6 |  |
| legacy-ascii-residue | 3 | Latin letters standing in for အ/ဥ/ဩ/ဧ — repaired by normalize/legacy_ascii.py |
| repeated-text | 2 |  |
| hex-placeholders | 1 |  |
| duplicated-text | 1 | adjacent duplicate lines |

## Per book

| book | JS failed | pages | ok/repaired/degraded/empty | symptom | evidence |
| --- | --- | --- | --- | --- | --- |
| `-1708528931770` | no | 1 | 0/0/1/0 | **legacy-ascii-residue** | A:40,U:6,E:2 Latin slots in Myanmar context on 1 page (font ?); B:80,D:66,R:38,V:15,N:11,W:9,X:8,Z:8,e:7,i:7,l:7,n:7,C:4,G:4,P:4,a:4,o:4,r:4,K:3,s:3,t:3,y:3,b:2,k:2,m:2,d:1,g:1,h:1,p:1,u:1,w:1 had no witnessed reading and stayed Latin |
| `-1758614468061` | no | 1 | 0/0/1/0 | **hex-placeholders** | 23 codes printed as placeholders like [00E5] (font ?) |
| `-1759341726906` | no | 1 | 0/0/1/0 | **detached-marks** | 662 combining marks sit alone between spaces (the shape of "နှင့်" written as "နှင် ့") |
| `100-management-methods-1791879233062` | no | 1 | 0/0/1/0 | **detached-marks** | 992 combining marks sit alone between spaces (the shape of "နှင့်" written as "နှင် ့") |
| `1680037523831` | no | 1 | 1/0/0/0 | **repeated-text** | 176 repeated lines on 1 page |
| `1680800753958` | yes | 1 | 0/0/1/0 | **detached-marks** | 51 combining marks sit alone between spaces (the shape of "နှင့်" written as "နှင် ့") |
| `1681459103962` | no | 1 | 1/0/0/0 | **repeated-text** | 188 repeated lines on 1 page |
| `1681549579413` | no | 1 | 0/0/1/0 | **detached-marks** | 2 combining marks sit alone between spaces (the shape of "နှင့်" written as "နှင် ့") |
| `1682739569276` | no | 1 | 0/0/1/0 | **detached-marks** | 1 combining marks sit alone between spaces (the shape of "နှင့်" written as "နှင် ့") |
| `1682768081583` | no | 1 | 0/0/1/0 | **detached-marks** | 18 combining marks sit alone between spaces (the shape of "နှင့်" written as "နှင် ့") |
| `1683082497742` | yes | 1 | 1/0/0/0 | **duplicated-text** | 4 adjacent duplicate lines |
| `1683988423841` | yes | 1 | 0/0/1/0 | **legacy-ascii-residue** |  Latin slots in Myanmar context on 1 page (font ?); x:28 had no witnessed reading and stayed Latin |
| `1687772069622` | yes | 1 | 0/1/0/0 | **legacy-ascii-residue** | A:322,U:18 Latin slots in Myanmar context on 1 page (font ?) |
| `1679530301329` | no | 1 | 1/0/0/0 | **ok** | 1 page produced readable text |
| `1681398248060` | no | 1 | 1/0/0/0 | **ok** | 1 page produced readable text |
| `1681716042142` | yes | 1 | 1/0/0/0 | **ok** | 1 page produced readable text |
| `1681774700481` | no | 1 | 1/0/0/0 | **ok** | 1 page produced readable text |
| `1683900729176` | yes | 1 | 1/0/0/0 | **ok** | 1 page produced readable text |
| `1686651510593` | yes | 1 | 1/0/0/0 | **ok** | 1 page produced readable text |
| `1687230296835` | no | 1 | 1/0/0/0 | **ok** | 1 page produced readable text |
| `1687771937896` | no | 1 | 1/0/0/0 | **ok** | 1 page produced readable text |
