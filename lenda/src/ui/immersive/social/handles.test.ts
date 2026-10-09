/**
 * @ e hashtags da rede social: sem espaço nem acento ("@gabigol júnior10" / "#Gabigol júnior10"
 * eram o bug), iguais aos dos posts do motor, e torcedor sem o tratamento no @.
 */
import { describe, expect, it } from 'vitest'
import { fanHandle, hashTag, userHandle } from './handles'

describe('handles da rede social', () => {
  it('o seu @ é o slug do motor + número da inscrição', () => {
    expect(userHandle({ identity: { surname: 'Gabigol Júnior', number: 10 } as never })).toBe('@gabigoljunior10')
    expect(userHandle({ identity: { surname: 'Ribeiro', number: 9 } as never })).toBe('@ribeiro9')
  })
  it('hashtag em CamelCase, sem acento nem espaço; siglas ficam', () => {
    expect(hashTag('Gabigol Júnior')).toBe('GabigolJunior')
    expect(hashTag('gabigol júnior')).toBe('GabigolJunior')
    expect(hashTag('São Paulo')).toBe('SaoPaulo')
    expect(hashTag('Athletico-PR')).toBe('AthleticoPR')
    expect(hashTag('RIBEIRO')).toBe('Ribeiro')
  })
  it('torcedor: o @ vem do nome, não de "Seu/Dona/Tia"', () => {
    expect(fanHandle('Dona Cida', 'fiel')).toBe('@cida_fiel')
    expect(fanHandle('Seu Jorge da Bandeira', 'raiz')).toBe('@jorge_raiz')
    expect(fanHandle('Tia Nena', '42')).toBe('@nena_42')
    expect(fanHandle('Zé da Geral', 'na_veia')).toBe('@ze_na_veia')
  })
})
