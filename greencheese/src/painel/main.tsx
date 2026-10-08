// Entrada do painel do dono (painel/index.html). Pacote separado do site: nada daqui entra no site público.
import { createRoot } from 'react-dom/client'
import './estilo'
import { Painel } from './Painel'

createRoot(document.getElementById('painel')!).render(<Painel />)
