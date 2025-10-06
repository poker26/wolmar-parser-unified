using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class OriginalProxyController : ControllerBase
    {
        private readonly HttpClient _httpClient;

        public OriginalProxyController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("load")]
        public async Task<IActionResult> LoadUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Согласно оригинальному репозиторию aioke/BrowserProxy
                // Сервер должен отправить запрос в Chrome расширение
                // Расширение загружает страницу и возвращает HTML
                
                // Пока что используем простой HTTP запрос
                var response = await _httpClient.GetAsync(url);
                
                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode(500, $"Failed to fetch URL: {response.StatusCode}");
                }

                var content = await response.Content.ReadAsStringAsync();

                return Ok(new
                {
                    success = true,
                    url = url,
                    html = content,
                    timestamp = System.DateTime.UtcNow,
                    method = "original_proxy"
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
