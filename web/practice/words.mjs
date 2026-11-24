const dictionary = 'https://sldict.korean.go.kr';
const media = `${dictionary}/multimedia/multimedia_files/convert`;

export const WORDS = [
  ['안녕하세요', '안녕하세요', 3331, '20191004/624421/MOV000244910'],
  ['감사합니다', '감사합니다', 2372, '20191028/632085/MOV000243986'],
  ['미안합니다', '미안합니다', 9917, '20191022/630183/MOV000253802'],
  ['아니요', '아니다', 11433, '20191028/631932/MOV000244884'],
  ['괜찮다', '괜찮다', 9466, '20191022/630119/MOV000249438'],
  ['이름', '이름', 7059, '20191015/627715/MOV000256668'],
  ['가족', '가족', 6770, '20201023/764397/MOV000250034'],
  ['좋다', '좋다', 9078, '20191022/629987/MOV000259382'],
  ['어디', '어디', 8799, '20200820/732429/MOV000243844'],
  ['먹다', '먹다', 10419, '20191025/630761/MOV000250824'],
].map(([name, label, entry, file]) => ({
  name,
  label,
  source: `${dictionary}/front/sign/signContentsView.do?origin_no=${entry}&top_category=CTE`,
  video: `${media}/${file}_700X466.mp4`,
}));
