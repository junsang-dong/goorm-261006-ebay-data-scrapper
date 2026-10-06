// 사용법: npm run hash:password -- "관리자 비밀번호"
// 출력된 값을 ADMIN_PASSWORD_HASH 에 넣는다. 비밀번호 원문은 저장하지 않는다.
import { randomBytes, scryptSync } from 'node:crypto';

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('12자 이상의 비밀번호를 인자로 전달하세요.');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`scrypt$${salt.toString('base64')}$${hash.toString('base64')}`);
